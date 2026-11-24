// Create a small synthetic WAV recording for manual recorded-upload testing.
// No real interview audio is needed: a two-part tone/silence pattern that is a
// valid 16-bit PCM WAV file the allowlist and signature checks accept.
//
//   node scripts/make-sample-audio.mjs [output] [seconds]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const output = process.argv[2] ?? '.data/sample-recording.wav';
const seconds = Math.max(0.5, Number(process.argv[3] ?? 2));
const sampleRate = 8000;
const samples = Math.round(sampleRate * seconds);
const dataSize = samples * 2;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write('RIFF', 0, 'latin1');
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8, 'latin1');
buffer.write('fmt ', 12, 'latin1');
buffer.writeUInt32LE(16, 16); // PCM chunk size
buffer.writeUInt16LE(1, 20); // PCM format
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
buffer.writeUInt16LE(2, 32); // block align
buffer.writeUInt16LE(16, 34); // bits per sample
buffer.write('data', 36, 'latin1');
buffer.writeUInt32LE(dataSize, 40);

// Alternate a 440 Hz tone with silence every second, like two "speakers".
for (let index = 0; index < samples; index += 1) {
	const second = Math.floor(index / sampleRate);
	const speaking = second % 2 === 0;
	const amplitude = speaking ? 8000 : 0;
	const value = Math.round(
		amplitude * Math.sin((2 * Math.PI * 440 * index) / sampleRate),
	);
	buffer.writeInt16LE(value, 44 + index * 2);
}

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, buffer);
console.log(`Wrote ${output} (${buffer.byteLength} bytes, ${seconds}s)`);
