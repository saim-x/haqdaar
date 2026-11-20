// Thin wrapper over the browser Web Speech API (Chrome / Edge / Safari).
// Works on localhost and HTTPS; the browser sends audio to its own speech service.

interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [i: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

function ctor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechRecognitionSupported = () => typeof window !== 'undefined' && !!ctor();

export interface ListenHandlers {
  onInterim: (text: string) => void;
  /** All alternatives of the final result, best first. */
  onFinal: (alternatives: { transcript: string; confidence: number }[]) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}

export function listen(lang: 'ur' | 'en', h: ListenHandlers): () => void {
  const C = ctor();
  if (!C) {
    h.onError('unsupported');
    h.onEnd();
    return () => undefined;
  }
  const r = new C();
  r.lang = lang === 'ur' ? 'ur-PK' : 'en-IN';
  r.interimResults = true;
  r.maxAlternatives = 4;
  r.continuous = false;
  let delivered = false;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        const alts: { transcript: string; confidence: number }[] = [];
        for (let k = 0; k < res.length; k++) alts.push({ transcript: res[k].transcript, confidence: res[k].confidence });
        delivered = true;
        h.onFinal(alts);
      } else interim += res[0].transcript;
    }
    if (interim) h.onInterim(interim);
  };
  r.onerror = (e) => h.onError(e.error);
  r.onend = () => {
    if (!delivered) h.onFinal([]);
    h.onEnd();
  };
  r.start();
  return () => r.stop();
}
