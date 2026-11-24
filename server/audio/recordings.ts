// Recording upload validation: multipart extraction with a size cap applied
// before any buffering — the body must declare a Content-Length within the cap
// (Node frames the body to it), and the buffered parts are re-checked after
// reading — plus the documented audio allowlist and signature validation
// against the actual bytes. The original filename is used only to pick the
// extension; it is never forwarded, logged, or persisted.
import {
	MAX_RECORDING_BYTES,
	RECORDING_KINDS,
	type RecordingExtension,
	describeRecordingAllowlist,
	recordingExtensionOf,
} from '../../shared/p1/audio';
import { getHeader, readMultipartFormData } from 'h3';
import type { H3Event } from 'h3';
import { invalidInput } from '../utils/http';

/** Slack for the small form fields around the recording itself. */
export const MAX_MULTIPART_BYTES = MAX_RECORDING_BYTES + 64 * 1024;

/** Below this a body cannot plausibly contain audio worth transcribing. */
export const MIN_RECORDING_BYTES = 64;

export type RecordingUpload = {
	bytes: Buffer;
	extension: RecordingExtension;
	/** Raw consent field value; the route validates the exact acknowledgement. */
	consentFieldValue: string | null;
};

function hexToBytes(hex: string): number[] {
	return hex
		.trim()
		.split(/\s+/)
		.map((value) => Number.parseInt(value, 16));
}

/** True when the bytes match one signature group of the allowlisted kind. */
export function matchesSignature(
	extension: RecordingExtension,
	bytes: Buffer,
): boolean {
	const kind = RECORDING_KINDS.find((entry) => entry.extension === extension);
	if (!kind) {
		return false;
	}
	return kind.signatures.some((group) =>
		group.every((check) => {
			const expected = hexToBytes(check.bytes);
			const mask = check.mask ? hexToBytes(check.mask) : null;
			if (bytes.length < check.offset + expected.length) {
				return false;
			}
			return expected.every((value, index) => {
				const actual = bytes[check.offset + index] as number;
				return mask
					? (actual & (mask[index] as number)) === (value & (mask[index] as number))
					: actual === value;
			});
		}),
	);
}

/**
 * Read and validate the multipart upload. Rejects before any buffering:
 * non-multipart bodies, missing or ambiguous Content-Length, and oversized
 * declared lengths. After buffering it rejects malformed multipart data,
 * missing/duplicate/misnamed files, oversized or tiny files, extensions
 * outside the allowlist, and content that does not match its declared audio
 * format.
 */
export async function readRecordingUpload(event: H3Event): Promise<RecordingUpload> {
	const contentType = getHeader(event, 'content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
		throw invalidInput('The recording must be uploaded as multipart form data.');
	}
	// The browser upload always declares its size, and Node delivers exactly
	// that many body bytes. A body without a trustworthy Content-Length cannot
	// be bounded before buffering, so it is rejected before a single byte is
	// read (chunked clients are out of scope; documented in the README).
	const declaredHeader = getHeader(event, 'content-length') ?? '';
	if (!/^\d+$/u.test(declaredHeader)) {
		throw invalidInput(
			'The upload must declare its size with a Content-Length header; uploads without a declared size are not accepted.',
		);
	}
	if (Number(declaredHeader) > MAX_MULTIPART_BYTES) {
		throw tooLarge();
	}
	let parts: Awaited<ReturnType<typeof readMultipartFormData>>;
	try {
		parts = (await readMultipartFormData(event)) ?? [];
	} catch {
		throw invalidInput('The upload could not be read as multipart form data.');
	}
	// Defense in depth: the buffered parts must also respect the cap, so a
	// lying or framework-level length change cannot silently raise the limit.
	const total = parts.reduce((sum, part) => sum + part.data.byteLength, 0);
	if (total > MAX_MULTIPART_BYTES) {
		throw tooLarge();
	}
	const files = parts.filter((part) => part.name === 'file');
	if (files.length === 0) {
		throw invalidInput('Attach a recording file in the file field.');
	}
	if (files.length > 1) {
		throw invalidInput('Send exactly one recording file.');
	}
	const file = files[0] as { data: Buffer; filename?: string };
	const consentParts = parts.filter((part) => part.name === 'consent');
	if (consentParts.length > 1) {
		throw invalidInput('Send the consent acknowledgement at most once.');
	}
	if (file.data.byteLength > MAX_RECORDING_BYTES) {
		throw tooLarge();
	}
	const extension = recordingExtensionOf(file.filename ?? null);
	if (extension === null) {
		throw invalidInput(
			`Recording files must be one of: ${describeRecordingAllowlist()}.`,
		);
	}
	if (file.data.byteLength < MIN_RECORDING_BYTES) {
		throw invalidInput('The recording is too short to transcribe.');
	}
	if (!matchesSignature(extension, file.data)) {
		throw invalidInput(
			`The file content does not match its .${extension} format; allowed formats: ${describeRecordingAllowlist()}.`,
		);
	}
	const consentRaw = consentParts[0]?.data.toString('utf8') ?? null;
	return { bytes: file.data, extension, consentFieldValue: consentRaw };
}

function tooLarge() {
	return invalidInput(
		`Recording uploads are limited to ${Math.floor(MAX_RECORDING_BYTES / (1024 * 1024))} MiB.`,
	);
}
