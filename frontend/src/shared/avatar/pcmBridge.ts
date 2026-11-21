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
export function splitForTts(text: string, maxChars = TTS_MAX_CHARS): string[] {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  if (flat.length <= maxChars) return [flat];

  // Keep the terminator with its sentence.
  const sentences = flat.match(/[^۔؟!?\n]+[۔؟!?]?/g) ?? [flat];
  const pieces: string[] = [];
  let current = '';

  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) pieces.push(trimmed);
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      // A single sentence longer than the cap: pack words greedily.
      if (current) {
        push(current);
        current = '';
      }
      let line = '';
      for (const word of sentence.split(' ')) {
        if (!line) {
          line = word;
        } else if (`${line} ${word}`.length <= maxChars) {
          line = `${line} ${word}`;
        } else {
          push(line);
          line = word;
        }
      }
      if (line) push(line);
      continue;
    }
    if (!current) {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      push(current);
      current = sentence;
    }
  }
  if (current) push(current);
  return pieces;
}

/**
 * Decode any browser-supported audio container to 24 kHz mono `pcm_s16le`.
 *
 * The `AudioContext` is created only to decode and is closed immediately: a
 * long-lived context would keep an audio device open on a phone that is trying
 * to save battery.
 */
export async function decodeToPcm24kMono(audioBuffer: ArrayBuffer): Promise<Int16Array> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio is not available');

  const decodeContext = new Ctx();
  let decoded: AudioBuffer;
  try {
    // `decodeAudioData` detaches the buffer, so hand it a copy.
    decoded = await decodeContext.decodeAudioData(audioBuffer.slice(0));
  } finally {
    void decodeContext.close().catch(() => undefined);
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * ANAM_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, ANAM_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  const channel = rendered.getChannelData(0);
  const pcm = new Int16Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    // Clamp before scaling: a value above 1.0 would wrap to a loud click.
    const sample = Math.max(-1, Math.min(1, channel[index] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

