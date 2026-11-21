/**
 * Web Audio → 24 kHz mono `pcm_s16le` bridge - ADR-025.
 *
 * Anam's audio passthrough expects raw little-endian 16-bit PCM at a fixed rate.
 * Our Urdu audio is MP3 at whatever rate Deepgram Flux produced. This module is
 * the whole conversion, in the browser, with no backend `ffmpeg`:
 *
 *   MP3 bytes → `AudioContext.decodeAudioData` → `OfflineAudioContext(1, n, 24000)`
 *             → clamped `Int16Array` → 4,800-byte chunks → `sendAudioChunk`
 *
 * Three details are load-bearing and easy to get wrong:
 *
 * 1. **Resampling must happen in an `OfflineAudioContext`, not by dropping
 *    samples.** Naive decimation aliases, and aliasing on speech sounds like a
 *    lisp - the citizen hears a defect, not a bandwidth saving.
 * 2. **A chunk must be a whole number of samples.** 4,800 bytes is 2,400 samples
 *    at 2 bytes each; an odd byte count would split a sample in half and the
 *    vendor would decode noise for the rest of the utterance.
 * 3. **`endSequence()` is what makes the avatar stop talking.** Without it the
 *    stream stays open and the mouth keeps moving after the sentence ended.
 */

/** The vendor's passthrough rate. Fixed by the session token, not by us. */
export const ANAM_SAMPLE_RATE = 24000;

/** 100 ms of 24 kHz mono 16-bit audio. */
export const CHUNK_BYTES = 4800;

/** `/voice/tts` rejects anything longer than this (`422 TEXT_TOO_LONG`). */
export const TTS_MAX_CHARS = 480;

/** The two methods this module needs from the SDK's audio stream. */
export interface PcmSink {
  sendAudioChunk(chunk: ArrayBuffer | Uint8Array | string): void;
  endSequence(): void;
}

/**
 * Split a sentence into `/voice/tts`-sized pieces on real sentence boundaries.
 *
 * Urdu ends a statement with `۔` and a question with `؟`; a Latin `.` inside an
 * Urdu sentence is usually a decimal point, so the splitter only treats `.` as a
 * terminator when it is followed by whitespace or the end of the string. A
 * sentence longer than `maxChars` is cut at a word boundary rather than mid-word,
 * because a TTS engine reading half a word is worse than two short clips.
 */
