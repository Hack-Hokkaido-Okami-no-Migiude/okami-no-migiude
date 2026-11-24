// P1 recorded-audio contracts shared by the server route, the provider client
// and the workbench control: the documented provider/model identity, the app's
// recording allowlist and size cap, the consent acknowledgement wording, and
// the wire schema for the unpersisted review draft. TS types derive from the
// schemas; nothing here may contain credentials or transcript content.
import { nonblank } from '../p0/schemas';
import { z } from 'zod';

/** The official batch speech-to-text model documented for recorded audio. */
export const AUDIO_MODEL_ID = 'scribe_v3';

/** The fixed official provider origin; only a loopback test URL may override it. */
export const OFFICIAL_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

/**
 * App-side upload cap. The provider accepts far larger files (up to 5 GB /
 * 15 hours), but a consulting workbench review draft must stay small, cheap
 * and fast, so uploads are capped well below that.
 */
export const MAX_RECORDING_BYTES = 10 * 1024 * 1024;

/** Multipart form field carrying the consent acknowledgement. */
export const RECORDED_CONSENT_FIELD = 'consent';

/** The exact value the field must carry; anything else fails consent. */
export const RECORDED_CONSENT_VALUE = 'true';

/**
 * Full disclosure shown before upload; the consent checkbox acknowledges it.
 * Covers: all participants agreed to recording and transfer, the provider's
 * default retention (possibly US storage), and that this app keeps no raw
 * audio. Zero-retention mode is NOT claimed: it is an enterprise-only
 * provider option this app does not enable.
 */
export const RECORDED_DISCLOSURE =
	'Confirm before uploading: everyone in this recording agreed to be recorded '
	+ 'and to have the audio transferred outside this app. The recording is sent '
	+ 'to the ElevenLabs speech-to-text API, which may retain the audio and '
	+ 'transcript under its default retention settings and may store or process '
	+ 'data in the United States. This workbench does not keep the raw audio; '
	+ 'transcription may incur provider charges.';

/** Fixed message for the `consent_required` rejection (no session details). */
export const RECORDED_CONSENT_REQUIRED_MESSAGE =
	'Recorded upload requires acknowledging that all participants in the '
	+ 'recording agreed to be recorded and to have the audio transferred, that '
	+ 'the provider may retain the audio under its default retention settings '
	+ '(possibly in the United States), and that this workbench does not keep '
	+ 'the raw audio; consent again to continue.';

// ---------------------------------------------------------------------------
// Recording allowlist: extension, forwarded MIME type, and content signatures
// (OR-groups of AND-ed byte checks) matched against the actual bytes.
// ---------------------------------------------------------------------------

export type RecordingExtension = 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a' | 'webm';

export type RecordingByteCheck = {
	offset: number;
	/** Hex byte values, space-separated (`FF Ex`). */
	bytes: string;
	/** Optional hex mask applied to the actual bytes before comparing. */
	mask?: string;
};

export type RecordingKind = {
	extension: RecordingExtension;
	mimeTypes: string[];
	label: string;
	signatures: RecordingByteCheck[][];
};

export const RECORDING_KINDS: RecordingKind[] = [
	{
		extension: 'mp3',
		mimeTypes: ['audio/mpeg', 'audio/mp3'],
		label: 'MP3 audio (.mp3)',
		signatures: [
			[{ offset: 0, bytes: '49 44 33' }],
			// MPEG audio frame sync (11 set bits): FF Ex with the low nibble masked.
			[{ offset: 0, bytes: 'FF E2', mask: 'FF E0' }],
		],
	},
	{
		extension: 'wav',
		mimeTypes: ['audio/wav', 'audio/x-wav'],
		label: 'WAV audio (.wav)',
		signatures: [
			[{ offset: 0, bytes: '52 49 46 46' }, { offset: 8, bytes: '57 41 56 45' }],
		],
	},
	{
		extension: 'flac',
		mimeTypes: ['audio/flac', 'audio/x-flac'],
		label: 'FLAC audio (.flac)',
		signatures: [[{ offset: 0, bytes: '66 4C 61 43' }]],
	},
	{
		extension: 'ogg',
		mimeTypes: ['audio/ogg'],
		label: 'OGG audio (.ogg)',
		signatures: [[{ offset: 0, bytes: '4F 67 67 53' }]],
	},
	{
		extension: 'm4a',
		mimeTypes: ['audio/mp4', 'audio/x-m4a'],
		label: 'M4A audio (.m4a)',
		signatures: [[{ offset: 4, bytes: '66 74 79 70' }]],
	},
	{
		extension: 'webm',
		mimeTypes: ['audio/webm'],
		label: 'WebM audio (.webm)',
		signatures: [[{ offset: 0, bytes: '1A 45 DF A3' }]],
	},
];

export const RECORDING_EXTENSIONS: string[] = RECORDING_KINDS.map(
	(kind) => `.${kind.extension}`,
);

/** The `accept` attribute for the file input. */
export const RECORDING_ACCEPT = RECORDING_EXTENSIONS.join(',');

/** Extension of a filename, lowercase, without the dot; null when absent. */
function extensionOf(filename: string | null): string | null {
	if (!filename) {
		return null;
	}
	const dot = filename.lastIndexOf('.');
	if (dot === -1 || dot === filename.length - 1) {
		return null;
	}
	return filename.slice(dot + 1).toLowerCase();
}

/** The allowed recording kind for a filename, or null when not allowlisted. */
export function recordingExtensionOf(
	filename: string | null,
): RecordingExtension | null {
	const extension = extensionOf(filename);
	const kind = RECORDING_KINDS.find((entry) => entry.extension === extension);
	return kind?.extension ?? null;
}

/** MIME type forwarded with the recording to the provider. */
export function recordingMimeType(extension: RecordingExtension): string {
	return RECORDING_KINDS.find((kind) => kind.extension === extension)
		?.mimeTypes[0] ?? 'application/octet-stream';
}

/** Human-readable allowlist for error messages and the README. */
export function describeRecordingAllowlist(): string {
	return RECORDING_KINDS.map((kind) => kind.label).join(', ');
}

// ---------------------------------------------------------------------------
// Wire contract of the transcribe route: an UNPERSISTED review draft.
// ---------------------------------------------------------------------------

/** One review row before it is saved; ids are assigned only on the save. */
export const DraftSegmentSchema = z.strictObject({
	speaker: z.string().nullable(),
	text: nonblank(),
	startMs: z.number().int().nonnegative().nullable(),
	endMs: z.number().int().nonnegative().nullable(),
});

export const DraftTranscriptSchema = z.strictObject({
	source: z.literal('audio'),
	segments: z.array(DraftSegmentSchema).max(5000),
});

/**
 * What happened to the provider-side stored transcription (best-effort
 * deletion attempt after a successful transcription):
 * - `deleted`: the provider confirmed deleting the stored transcription.
 * - `unavailable`: the provider response had no transcription id to target,
 *   so no deletion was possible; retention depends on provider settings.
 * - `failed`: the deletion request did not complete; whether the provider
 *   retained anything is unknown. Never presented as a deletion.
 */
export const PROVIDER_CLEANUP_STATES = ['deleted', 'unavailable', 'failed'] as const;

export const TranscribeResponseSchema = z.strictObject({
	draft: DraftTranscriptSchema,
	languageCode: z.string().nullable(),
	cleanup: z.enum(PROVIDER_CLEANUP_STATES),
});

export type DraftSegment = z.infer<typeof DraftSegmentSchema>;
export type DraftTranscript = z.infer<typeof DraftTranscriptSchema>;
export type ProviderCleanup = (typeof PROVIDER_CLEANUP_STATES)[number];
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;
