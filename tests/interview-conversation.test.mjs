// Unit tests for the interview conversation controller: the proven
// Conversation.startSession argument shape (byte-equal to the options the
// former /voice page sent in production on the same @elevenlabs/client
// 1.36.1 — no interview-specific dynamic variables), the live transcript
// collection (onMessage turns, correction patching, reset between
// sessions) and the research handoff guard (only a confirmed in-call
// connection may receive the contextual update). The browser SDK is
// intercepted with an in-process module hook, and the browser globals the
// controller touches (navigator.mediaDevices, window.RTCPeerConnection)
// are stubbed.
// Run: node --test tests/interview-conversation.test.mjs
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const MOCK_SOURCE = [
	// Stable delegating wrapper: the module is evaluated once and cached,
	// so it must forward every startSession call to the mock object the
	// active test installed on globalThis.
	'export const Conversation = {',
	'  startSession: (init) => globalThis.__elevenLabsClientMock.startSession(init),',
	'};',
	'',
].join('\n');

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '@elevenlabs/client') {
			return { url: 'mock:elevenlabs-client', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === 'mock:elevenlabs-client') {
			return {
				format: 'module',
				shortCircuit: true,
				source: MOCK_SOURCE,
			};
		}
		return nextLoad(url, context);
	},
});

const { useInterviewConversation } =
	await import('../app/composables/useInterviewConversation.ts');

const BUSINESS = { businessName: '湯の花旅館', location: 'ニセコ町' };

/**
 * Installs the browser globals the controller probes before it will start
 * a session, plus a recording stand-in for the SDK's Conversation object.
 */
function installBrowserStubs({ withMedia = true } = {}) {
	Object.defineProperty(globalThis, 'navigator', {
		value:
			withMedia ?
				{ mediaDevices: { getUserMedia: async () => ({}) } }
			:	{},
		configurable: true,
	});
	globalThis.window = { RTCPeerConnection: class {} };
	const starts = [];
	const sessions = [];
	globalThis.__elevenLabsClientMock = {
		async startSession(init) {
			starts.push(init);
			const session = {
				ended: false,
				updates: [],
				async endSession() {
					this.ended = true;
				},
				sendContextualUpdate(text) {
					this.updates.push(text);
				},
			};
			sessions.push(session);
			return session;
		},
	};
	return { starts, sessions };
}

function uninstallBrowserStubs() {
	Object.defineProperty(globalThis, 'navigator', {
		value: {},
		configurable: true,
	});
	delete globalThis.window;
	delete globalThis.__elevenLabsClientMock;
}

/** Splits one recorded startSession invocation into data and callbacks. */
function splitInvocation(init) {
	const {
		onMessage,
		onAgentResponseCorrection,
		onDisconnect,
		onError,
		...data
	} = init;
	return {
		data,
		callbacks: {
			onMessage,
			onAgentResponseCorrection,
			onDisconnect,
			onError,
		},
	};
}

/**
 * Lets the controller's dynamic SDK import (cached, but resolved through
 * the module hooks over several microtasks) reach its startSession call.
 * A macrotask boundary drains every pending microtask deterministically.
 */
async function flushLoader() {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

test('startSession is called with exactly the proven /voice arguments (ja)', async () => {
	const { starts, sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		const started = await chat.start({
			conversationToken: 'minted-token',
			language: 'ja',
			...BUSINESS,
		});
		assert.equal(started, true);
		assert.equal(chat.callState.value, 'in-call');
		assert.equal(starts.length, 1);
		const { data, callbacks } = splitInvocation(starts[0]);
		assert.deepEqual(data, {
			conversationToken: 'minted-token',
			connectionType: 'webrtc',
			stripAudioTags: true,
			dynamicVariables: {
				web_business_context:
					'{"business_name":"湯の花旅館","location":"ニセコ町"}',
				web_intake_complete: true,
			},
		});
		// The proven ja call sent no language override at all.
		assert.equal('overrides' in starts[0], false);
		assert.equal(typeof callbacks.onMessage, 'function');
		assert.equal(typeof callbacks.onAgentResponseCorrection, 'function');
		assert.equal(typeof callbacks.onDisconnect, 'function');
		assert.equal(typeof callbacks.onError, 'function');
		assert.equal(sessions.length, 1);
	} finally {
		uninstallBrowserStubs();
	}
});

test('startSession is called with exactly the proven /voice arguments (en)', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		const started = await chat.start({
			conversationToken: 'minted-token',
			language: 'en',
			...BUSINESS,
		});
		assert.equal(started, true);
		const { data } = splitInvocation(starts[0]);
		assert.deepEqual(data, {
			conversationToken: 'minted-token',
			connectionType: 'webrtc',
			stripAudioTags: true,
			dynamicVariables: {
				web_business_context:
					'{"business_name":"湯の花旅館","location":"ニセコ町"}',
				web_intake_complete: true,
			},
			overrides: { agent: { language: 'en' } },
		});
	} finally {
		uninstallBrowserStubs();
	}
});

test('no interview id dynamic variable is sent to the SDK', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'minted-token',
			language: 'ja',
			...BUSINESS,
		});
		// The webhook transcript match relies on the mint-time
		// conversation↔interview association, not on client-sent ids.
		assert.deepEqual(Object.keys(starts[0].dynamicVariables), [
			'web_business_context',
			'web_intake_complete',
		]);
	} finally {
		uninstallBrowserStubs();
	}
});

test('an incomplete business profile sends no business context variable', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'minted-token',
			language: 'ja',
			businessName: '  湯の花旅館  ',
			location: '   ',
		});
		assert.equal(starts[0].dynamicVariables.web_business_context, '{}');
	} finally {
		uninstallBrowserStubs();
	}
});

test('onMessage turns are collected, trimmed and rendered-ready', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'minted-token',
			language: 'ja',
			...BUSINESS,
		});
		const { callbacks } = splitInvocation(starts[0]);
		callbacks.onMessage({ role: 'agent', message: 'こんにちは。 ' });
		callbacks.onMessage({
			role: 'user',
			message: '  予約を手で写しています。',
		});
		assert.deepEqual(chat.turns.value, [
			{ role: 'agent', message: 'こんにちは。' },
			{ role: 'user', message: '予約を手で写しています。' },
		]);
	} finally {
		uninstallBrowserStubs();
	}
});

test('junk conversation events never enter the transcript', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'minted-token',
			language: 'ja',
			...BUSINESS,
		});
		const { callbacks } = splitInvocation(starts[0]);
		callbacks.onMessage({ role: 'ai', message: 'legacy role' });
		callbacks.onMessage({ role: 'agent' });
		callbacks.onMessage({ role: 'agent', message: '   ' });
		callbacks.onMessage({ message: 'no role' });
		callbacks.onMessage(null);
		assert.deepEqual(chat.turns.value, []);
	} finally {
		uninstallBrowserStubs();
	}
});

test('an agent response correction patches the matching agent turn', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'minted-token',
			language: 'ja',
			...BUSINESS,
		});
		const { callbacks } = splitInvocation(starts[0]);
		callbacks.onMessage({
			role: 'agent',
			message: 'まず、いま一番大変なことは何ですか。',
		});
		callbacks.onMessage({ role: 'user', message: '従業員が足りません。' });
		callbacks.onAgentResponseCorrection({
			original_agent_response: 'まず、いま一番大変なことは何ですか。',
			corrected_agent_response: 'まず、一番大変なことは何ですか。',
		});
		assert.deepEqual(chat.turns.value, [
			{ role: 'agent', message: 'まず、一番大変なことは何ですか。' },
			{ role: 'user', message: '従業員が足りません。' },
		]);
		// A correction whose original no longer matches leaves the turn.
		callbacks.onAgentResponseCorrection({
			original_agent_response: '別の応答',
			corrected_agent_response: '置き換えられてはいけない',
		});
		assert.equal(
			chat.turns.value[0].message,
			'まず、一番大変なことは何ですか。',
		);
	} finally {
		uninstallBrowserStubs();
	}
});

test('a new session starts with an empty transcript', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		splitInvocation(starts[0]).callbacks.onMessage({
			role: 'agent',
			message: ' first call ',
		});
		assert.equal(chat.turns.value.length, 1);
		await chat.start({
			conversationToken: 'token-2',
			language: 'ja',
			...BUSINESS,
		});
		assert.deepEqual(chat.turns.value, []);
	} finally {
		uninstallBrowserStubs();
	}
});

test('a superseded session never resurrects the call', async () => {
	const { starts, sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		const first = await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		assert.equal(first, true);
		// The page can end the call while a second start is still
		// connecting: the in-flight start is superseded before it ever
		// creates a session, and the call stays ended.
		const pending = chat.start({
			conversationToken: 'token-2',
			language: 'ja',
			...BUSINESS,
		});
		await chat.end();
		assert.equal(chat.callState.value, 'ended');
		const second = await pending;
		assert.equal(second, false);
		assert.equal(chat.callState.value, 'ended');
		// Only the first session ever existed, and end() closed it.
		assert.equal(starts.length, 1);
		assert.equal(sessions.length, 1);
		assert.equal(sessions[0].ended, true);
	} finally {
		uninstallBrowserStubs();
	}
});

test('the research handoff only fires on a confirmed connection', async () => {
	const { starts, sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		// While still connecting there is nothing to hand to.
		let releaseStart;
		globalThis.__elevenLabsClientMock.startSession = (init) => {
			starts.push(init);
			return new Promise((resolve) => {
				releaseStart = resolve;
			});
		};
		const pending = chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		// Let the start reach its hanging startSession call first.
		await flushLoader();
		assert.equal(chat.callState.value, 'connecting');
		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'case' }],
		});
		const liveSession = {
			ended: false,
			updates: [],
			async endSession() {
				this.ended = true;
			},
			sendContextualUpdate(text) {
				this.updates.push(text);
			},
		};
		sessions.push(liveSession);
		releaseStart(liveSession);
		assert.equal(await pending, true);
		assert.equal(chat.callState.value, 'in-call');
		// Once in-call the completed research reaches the agent, exactly once.
		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'LINE mini app group bookings' }],
		});
		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'a second case' }],
		});
		assert.equal(sessions[0].updates.length, 1);
		assert.match(sessions[0].updates[0], /Linkup research is complete/);
		assert.match(sessions[0].updates[0], /LINE mini app group bookings/);
	} finally {
		uninstallBrowserStubs();
	}
});

test('the research handoff is silent after a disconnect', async () => {
	const { starts, sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		const { callbacks } = splitInvocation(starts[0]);
		// The agent hangs up before the research ever completed.
		callbacks.onDisconnect();
		assert.equal(chat.callState.value, 'ended');
		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'case' }],
		});
		chat.handOffResearch({ status: 'failed' });
		assert.equal(sessions[0].updates.length, 0);
	} finally {
		uninstallBrowserStubs();
	}
});

test('the research handoff is silent after the page ends the call', async () => {
	const { sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		await chat.end();
		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'case' }],
		});
		assert.equal(sessions[0].updates.length, 0);
	} finally {
		uninstallBrowserStubs();
	}
});

test('failed or empty research hands off the fallback guidance once', async () => {
	const { sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		chat.handOffResearch({ status: 'failed' });
		chat.handOffResearch({ status: 'failed' });
		assert.equal(sessions[0].updates.length, 1);
		assert.match(sessions[0].updates[0], /Linkup research failed/);
		// A null surface (no live research rows) is never a handoff.
		chat.handOffResearch(null);
		assert.equal(sessions[0].updates.length, 1);
	} finally {
		uninstallBrowserStubs();
	}
});

test('completed research without cases hands off the no-cases guidance', async () => {
	const { sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		chat.handOffResearch({ status: 'completed', cases: null });
		assert.equal(sessions[0].updates.length, 1);
		assert.match(
			sessions[0].updates[0],
			/Linkup research returned no sourced cases/,
		);
	} finally {
		uninstallBrowserStubs();
	}
});

test('without media support the call never starts and no session is created', async () => {
	const { starts } = installBrowserStubs({ withMedia: false });
	try {
		const chat = useInterviewConversation();
		const started = await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		assert.equal(started, false);
		assert.equal(chat.callState.value, 'idle');
		assert.equal(chat.failure.value, 'unsupported');
		assert.equal(starts.length, 0);
	} finally {
		uninstallBrowserStubs();
	}
});

test('a denied microphone maps to the mic failure state', async () => {
	const { starts } = installBrowserStubs();
	globalThis.__elevenLabsClientMock.startSession = async (init) => {
		starts.push(init);
		const denial = new Error('denied');
		denial.name = 'NotAllowedError';
		throw denial;
	};
	try {
		const chat = useInterviewConversation();
		const started = await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		assert.equal(started, false);
		assert.equal(chat.failure.value, 'mic');
		assert.equal(starts.length, 1);
	} finally {
		uninstallBrowserStubs();
	}
});

test('ending the call ends the session and clears the conversation', async () => {
	const { sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		await chat.end();
		assert.equal(chat.callState.value, 'ended');
		assert.equal(sessions[0].ended, true);
	} finally {
		uninstallBrowserStubs();
	}
});

test('a dropped connection moves the call to the ended state', async () => {
	const { starts } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		splitInvocation(starts[0]).callbacks.onDisconnect();
		assert.equal(chat.callState.value, 'ended');
	} finally {
		uninstallBrowserStubs();
	}
});

test('a fired research handoff is announced once as a system turn', async () => {
	const { starts, sessions } = installBrowserStubs();
	try {
		const chat = useInterviewConversation();
		await chat.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		const { callbacks } = splitInvocation(starts[0]);
		callbacks.onMessage({
			role: 'user',
			message: 'よろしくお願いします。',
		});
		// Pending research states add nothing to the caption stream.
		chat.handOffResearch({ status: 'started', started: true, cases: null });
		assert.equal(chat.turns.value.length, 1);

		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'A' }, { title: 'B' }],
		});
		assert.deepEqual(chat.turns.value[1], {
			role: 'system',
			event: 'research-completed',
			caseCount: 2,
		});
		// The handoff stays idempotent: no second announcement or update.
		chat.handOffResearch({
			status: 'completed',
			cases: [{ title: 'A' }, { title: 'B' }],
		});
		assert.equal(chat.turns.value.length, 2);
		assert.equal(sessions[0].updates.length, 1);
	} finally {
		uninstallBrowserStubs();
	}
});

test('empty and failed research handoffs carry their own system event', async () => {
	installBrowserStubs();
	try {
		const empty = useInterviewConversation();
		await empty.start({
			conversationToken: 'token-1',
			language: 'ja',
			...BUSINESS,
		});
		empty.handOffResearch({ status: 'completed', cases: [] });
		assert.deepEqual(empty.turns.value, [
			{ role: 'system', event: 'research-empty' },
		]);

		const failed = useInterviewConversation();
		await failed.start({
			conversationToken: 'token-2',
			language: 'ja',
			...BUSINESS,
		});
		failed.handOffResearch({ status: 'failed' });
		assert.deepEqual(failed.turns.value, [
			{ role: 'system', event: 'research-failed' },
		]);
	} finally {
		uninstallBrowserStubs();
	}
});
