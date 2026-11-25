import type { IncomingMessage, ServerResponse } from 'node:http';
import {
	createShimaBoundary,
	hidePilotRoute,
	markShimaDispatch,
} from '../middleware/shima-boundary';
import { Buffer } from 'node:buffer';
import type { NitroAppPlugin } from 'nitropack/types';
// Nitro's virtual manifest is registered by Rollup, not exposed in its TS types.
// @ts-expect-error -- Nitro's built-in static asset manifest.
import { getAsset } from '#nitro-internal-virtual/public-assets';
import { readNodePilotRequest } from './deployment';

const boundary = createShimaBoundary({
	SHIMA_MODE: process.env.SHIMA_MODE,
	SHIMA_PILOT_ORIGIN: process.env.SHIMA_PILOT_ORIGIN,
	SHIMA_PILOT_BUSINESS_ID: process.env.SHIMA_PILOT_BUSINESS_ID,
	SHIMA_PILOT_PRINCIPALS_JSON: process.env.SHIMA_PILOT_PRINCIPALS_JSON,
}, (path) => Boolean(getAsset(path)));

// This must be registered in nitro.plugins, not just server/middleware: Nitro
// puts route rules and static files earlier in the H3 stack. Neither this hook
// nor H3 middleware intercepts a Node upgrade event; keep Nitro's websocket
// adapter disabled until its own raw upgrade boundary is implemented.
const shimaRuntime: NitroAppPlugin = ({ h3App }) => {
	const dispatch = h3App.handler;
	h3App.handler = (event) => {
		if (!boundary.admit(event.node.req, event.node.res)) {return;}
		markShimaDispatch(event.node.req);
		return dispatch(event);
	};
};
export default shimaRuntime;

const maxLoginBytes = 512;
const loginDeadlineMs = 5_000;
const loginWindowMs = 60_000;
const maxLoginPerWindow = 30;
const maxLoginInFlight = 4;
let windowStart = performance.now();
let attempts = 0;
let inFlight = 0;

function problem(res: ServerResponse, status: number, code: string, message: string) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ error: { code, message } }));
}

function loginFrame(rawHeaders: readonly string[]) {
	let type: string | undefined;
	let length: string | undefined;
	for (let index = 0; index < rawHeaders.length; index += 2) {
		const name = rawHeaders[index]!.toLowerCase();
		const value = rawHeaders[index + 1]!;
		switch (name) {
			case 'content-type':
				if (type !== undefined) {return null;}
				type = value;
				break;
			case 'content-length':
				if (length !== undefined) {return null;}
				length = value;
				break;
			case 'content-encoding':
			case 'transfer-encoding':
			case 'expect':
				return null;
		}
	}
	if (!length || !/^[1-9][0-9]*$/.test(length)) {return null;}
	if (Number(length) > maxLoginBytes) {return { oversized: true } as const;}
	const form = /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(type ?? '');
	if (!form && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type ?? '')) {return null;}
	return { oversized: false, size: Number(length), form } as const;
}

function loginBody(req: IncomingMessage, size: number) {
	return new Promise<string | null>((resolve) => {
		const body = Buffer.alloc(size);
		let received = 0;
		const timer = setTimeout(fail, loginDeadlineMs);
		function finish(value: string | null) {
			clearTimeout(timer);
			req.pause();
			req.off('data', read);
			req.off('end', done);
			req.off('close', fail);
			resolve(value);
		}
		function fail() { finish(null); }
		function read(chunk: Buffer) {
			if (received + chunk.length > size) { fail(); return; }
			chunk.copy(body, received);
			received += chunk.length;
		}
		function done() { finish(received === size ? body.toString('latin1') : null); }
		req.on('data', read);
		req.once('end', done);
		req.once('close', fail);
		// Leave a one-shot handler for late socket failures on an incomplete body.
		req.once('error', fail);
	});
}

export async function handlePilotSession(req: IncomingMessage, res: ServerResponse) {
	const raw = readNodePilotRequest(req);
	// Check again at the route, before examining input framing or reading bytes.
	if (!boundary.canLogin(raw)) { hidePilotRoute(res); return; }
	res.setHeader('Cache-Control', 'no-store');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.shouldKeepAlive = false;
	const frame = loginFrame(raw.rawHeaders);
	if (!frame) { problem(res, 400, 'invalid_input', 'Invalid sign-in request.'); return; }
	if (frame.oversized) { problem(res, 413, 'invalid_input', 'Invalid sign-in request.'); return; }

	const now = performance.now();
	if (now - windowStart >= loginWindowMs) { attempts = 0; windowStart = now; }
	if (attempts >= maxLoginPerWindow || inFlight >= maxLoginInFlight) {
		res.setHeader('Retry-After', String(Math.ceil(loginWindowMs / 1000)));
		problem(res, 429, 'rate_limited', 'Sign-in temporarily unavailable.');
		return;
	}
	attempts++;
	inFlight++;
	let body: string | null;
	try { body = await loginBody(req, frame.size); }
	finally { inFlight--; }
	if (res.destroyed) {return;}

	// The single field is ASCII base64url. Refuse duplicate JSON keys,
	// percent-escaped form aliases, nested or extra properties, and any BOM.
	const token = (frame.form ?
		/^token=([A-Za-z0-9_-]{43})(?![\s\S])/
		: /^[\x20\t\r\n]*\{[\x20\t\r\n]*"token"[\x20\t\r\n]*:[\x20\t\r\n]*"([A-Za-z0-9_-]{43})"[\x20\t\r\n]*\}[\x20\t\r\n]*(?![\s\S])/).exec(body ?? '')?.[1];
	if (!token) { problem(res, 400, 'invalid_input', 'Invalid sign-in request.'); return; }
	let cookie: string | null;
	try { cookie = boundary.issueCookie(raw, token); }
	catch { problem(res, 503, 'unavailable', 'Sign-in temporarily unavailable.'); return; }
	if (!cookie) { hidePilotRoute(res); return; }
	res.setHeader('Set-Cookie', cookie);
	res.statusCode = frame.form ? 303 : 204;
	if (frame.form) {res.setHeader('Location', '/');}
	res.end();
}
