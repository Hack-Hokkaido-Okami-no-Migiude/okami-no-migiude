// Public seam of the server-side live-voice provider adapter. This barrel is
// the frozen surface a guarded Nitro route (and the privacy worker's relay
// wiring) consumes; signatures are documented in server/voice/README.md and
// only extended deliberately (bump VOICE_SEAM_VERSION).
export * from './config';
export * from './clock';
export * from './epoch';
export * from './errors';
export * from './scribe';
export * from './socket';
export * from './tts';

/** Bump when a frozen seam signature changes shape or meaning. */
export const VOICE_SEAM_VERSION = 1;
