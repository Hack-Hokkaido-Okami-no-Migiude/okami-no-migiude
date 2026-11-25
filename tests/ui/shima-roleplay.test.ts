import {
	type ShimaRoleplayMediaEvent,
	createShimaRoleplayPlayer,
} from '../../app/components/shima/roleplay/roleplay-player';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { shimaRoleplayClips } from '../../app/components/shima/roleplay/roleplay-clips';
import test from 'node:test';

const repoRoot = join(import.meta.dirname, '..', '..');

function readApp(...parts: string[]) {
	return readFileSync(join(repoRoot, ...parts), 'utf8');
}

type FakeMedia = {
	play: () => Promise<void>;
	pause: () => void;
	on: (kind: ShimaRoleplayMediaEvent, handler: () => void) => void;
	dispose: () => void;
	fire: (kind: ShimaRoleplayMediaEvent) => void;
	disposed: boolean;
};

type OpenMedia = Parameters<typeof createShimaRoleplayPlayer>[0];

function fakeMediaFactory(mode: 'ok' | 'reject' | 'none') {
	const created: FakeMedia[] = [];
	const open: OpenMedia = () => {
		if (mode === 'none') {
			return null;
		}
		const handlers = new Map<ShimaRoleplayMediaEvent, () => void>();
		const media: FakeMedia = {
			play: () =>
				mode === 'reject' ?
					Promise.reject(new Error('playback blocked'))
				:	Promise.resolve(),
			pause: () => {},
			on: (kind, handler) => {
				handlers.set(kind, handler);
			},
			dispose: () => {
				media.disposed = true;
			},
			fire: (kind) => {
				handlers.get(kind)?.();
			},
			disposed: false,
		};
		created.push(media);
		return media;
	};
	return { created, open };
}

test('the catalog lists exactly the three verified fictional clips', () => {
	assert.deepEqual(
		shimaRoleplayClips.map((clip) => clip.id),
		['intro-owner', 'question-shima', 'answer-owner'],
	);
	for (const clip of shimaRoleplayClips) {
		assert.equal(clip.src, `/demo/shima/shima-demo-${clip.id}.wav`);
		assert.ok(clip.label.includes('（事前録音・架空）'));
		assert.ok(clip.stopLabel.endsWith('停止'));
		assert.ok(clip.caption.length > 10);
		assert.ok(clip.speaker.includes('架空'));
	}
	assert.deepEqual(
		new Set(shimaRoleplayClips.map((clip) => clip.src)).size,
		3,
	);
});

test('the credited WAV assets exist in public/demo/shima', () => {
	for (const clip of shimaRoleplayClips) {
		const file = join(repoRoot, 'public', clip.src.slice(1));
		const size = readFileSync(file).byteLength;
		assert.ok(size > 10_000, `${clip.src} is ${size} bytes`);
	}
});

test('captions are byte-identical to the verified script and demo text', () => {
	const demoSource = readApp('app', 'composables', 'useShimaDemo.ts');
	const intakeSource = readApp(
		'app',
		'components',
		'shima',
		'ShimaDemoIntake.vue',
	);
	const scriptSource = readApp(
		'tests',
		'browser',
		'shima-roleplay-script.md',
	);
	const captions = [...scriptSource.matchAll(/Caption: (.+)/g)].map(
		(match) => match[1],
	);
	assert.equal(captions.length, 3);
	const [intro, question, answer] = captions;
	const [introClip, questionClip, answerClip] = shimaRoleplayClips;
	assert.equal(introClip.caption, intro);
	// The question caption equals the displayed shimaDemoQuestion literal.
	assert.equal(
		questionClip.caption,
		demoSource.match(/shimaDemoQuestion\s*=\s*'([^']+)'/)?.[1],
	);
	assert.equal(questionClip.caption, question);
	// The answer caption equals the 台本の回答 line the intake panel shows.
	assert.ok(intakeSource.includes(`台本の回答：${answerClip.caption}`));
	assert.equal(answerClip.caption, answer);
	for (const clip of shimaRoleplayClips) {
		assert.ok(scriptSource.includes(`public${clip.src}`));
	}
	assert.ok(
		readApp('public', 'demo', 'shima', 'CREDITS.md').includes(
			'VOICEVOX Nemo',
		),
	);
});

test('playback starts on demand, stops on a second press and never overlaps', async () => {
	const fake = fakeMediaFactory('ok');
	const player = createShimaRoleplayPlayer(fake.open);
	assert.equal(player.snapshot().status['intro-owner'], 'idle');
	await player.toggle('intro-owner');
	assert.equal(player.snapshot().status['intro-owner'], 'playing');
	await player.toggle('intro-owner');
	assert.equal(player.snapshot().status['intro-owner'], 'idle');
	assert.equal(fake.created[0]?.disposed, true);
	// Starting another clip stops the first one; one clip plays at a time.
	await player.toggle('intro-owner');
	await player.toggle('question-shima');
	assert.equal(player.snapshot().status['intro-owner'], 'idle');
	assert.equal(fake.created[0]?.disposed, true);
	assert.equal(fake.created[1]?.disposed, true);
	assert.equal(player.snapshot().status['question-shima'], 'playing');
	assert.equal(fake.created[2]?.disposed, false);
});

test('a failed start degrades to the unavailable notice while text stays', async () => {
	const fake = fakeMediaFactory('reject');
	const player = createShimaRoleplayPlayer(fake.open);
	await player.toggle('answer-owner');
	const snapshot = player.snapshot();
	assert.equal(snapshot.status['answer-owner'], 'unavailable');
	assert.ok(snapshot.notice.includes('文字表示はそのまま'));
	// A retry is allowed and re-attempts playback with a fresh element.
	await player.toggle('answer-owner');
	assert.equal(fake.created.length, 2);
	// The captions are plain catalog data, never mutated by playback state.
	for (const clip of shimaRoleplayClips) {
		assert.ok(clip.caption.length > 10);
	}
});

test('ended and error events resolve the state without touching other clips', async () => {
	const fake = fakeMediaFactory('ok');
	const player = createShimaRoleplayPlayer(fake.open);
	await player.toggle('question-shima');
	fake.created[0]?.fire('ended');
	assert.equal(player.snapshot().status['question-shima'], 'idle');
	await player.toggle('question-shima');
	fake.created[1]?.fire('error');
	const snapshot = player.snapshot();
	assert.equal(snapshot.status['question-shima'], 'unavailable');
	assert.ok(snapshot.notice.length > 0);
});

test('late events from a stopped clip cannot clobber the playing one', async () => {
	const fake = fakeMediaFactory('ok');
	const player = createShimaRoleplayPlayer(fake.open);
	await player.toggle('intro-owner');
	await player.toggle('question-shima');
	fake.created[0]?.fire('ended');
	fake.created[0]?.fire('error');
	const snapshot = player.snapshot();
	assert.equal(snapshot.status['question-shima'], 'playing');
	assert.equal(snapshot.status['intro-owner'], 'idle');
});

test('a missing media seam degrades gracefully and listeners see transitions', async () => {
	const fake = fakeMediaFactory('none');
	const player = createShimaRoleplayPlayer(fake.open);
	let calls = 0;
	const stop = player.subscribe(() => {
		calls++;
	});
	await player.toggle('intro-owner');
	const snapshot = player.snapshot();
	assert.equal(snapshot.status['intro-owner'], 'unavailable');
	assert.ok(snapshot.notice.length > 0);
	assert.ok(calls > 0);
	stop();
	const before = calls;
	await player.toggle('intro-owner');
	assert.equal(calls, before);
});

test('the roleplay seam never touches capture, providers or evidence', () => {
	const sources = [
		'app/components/shima/roleplay/roleplay-clips.ts',
		'app/components/shima/roleplay/roleplay-player.ts',
		'app/components/shima/roleplay/ShimaRoleplayAudio.vue',
	].map((path) => readApp(...path.split('/')));
	const combined = sources.join('\n');
	for (const banned of [
		'getUserMedia',
		'MediaRecorder',
		'MediaStream',
		'mediaDevices',
		'XMLHttpRequest',
		'WebSocket',
		'$fetch',
		'fetch(',
		'sendBeacon',
		'useShimaDemo',
		'/api/',
	]) {
		assert.ok(
			!combined.includes(banned),
			`roleplay must not use ${banned}`,
		);
	}
	for (const source of sources) {
		assert.ok(!/from\s+'[^']*shima\/voice/.test(source));
	}
});

test('the intake panel keeps its fixture actions and mounts the roleplay block', () => {
	const intake = readApp('app', 'components', 'shima', 'ShimaDemoIntake.vue');
	for (const kept of [
		'data-testid="shima-demo-open"',
		'data-testid="shima-demo-answer"',
		'data-testid="shima-demo-question"',
		"emit('open')",
		"emit('answer')",
		'台本の回答：繁忙期は週に約10回。',
	]) {
		assert.ok(intake.includes(kept), `intake must keep ${kept}`);
	}
	assert.ok(intake.includes('<ShimaRoleplayAudio />'));
	assert.ok(
		intake.includes(
			'録音は事前録音の架空ボイスで、マイクも外部AIも使いません。',
		),
	);
});
