// Manual-verification helper: run the local ElevenLabs speech-to-text stub
// (the same canned Japanese two-speaker transcription the test suites use)
// on a fixed loopback port so the workbench can be exercised end to end in a
// browser without any real provider credentials or network calls.
//
//   node --import tsx scripts/dev-audio-stub.mjs [port]     (default 9378)
//
// Then point the app at it (trusted local/test configuration only):
//   NUXT_ELEVENLABS_API_KEY=stub-local
//   NUXT_ELEVENLABS_BASE_URL=http://127.0.0.1:9378
import { startAudioStub } from '../tests/api/helpers/audio-stub.ts';

const port = Number(process.argv[2] ?? 9378);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error('Usage: node --import tsx scripts/dev-audio-stub.mjs [port]');
	process.exit(1);
}
const stub = await startAudioStub(port);
console.log(`ElevenLabs speech-to-text stub on ${stub.url}`);
console.log('Serve the app with:');
console.log(`  NUXT_ELEVENLABS_API_KEY=stub-local`);
console.log(`  NUXT_ELEVENLABS_BASE_URL=${stub.url}`);
console.log('POST /v1/speech-to-text returns the canned Japanese draft; DELETE acknowledges deletion.');
