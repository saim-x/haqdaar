import { Volume2, Square } from 'lucide-react';
import { play, stopAudio, usePlayingId } from '../audio';
import { useT } from '../i18n';
import { cx } from './cx';

interface Props {
  clip?: string;
  text: string;
  /** Speak in this language regardless of UI language. */
  lang?: 'ur' | 'en';
  size?: 'md' | 'lg';
  className?: string;
  label?: string;
  ttsUrl?: () => Promise<string | null>;
}

/** The 56x56 "listen" button present on every citizen screen (docs/11 §2.2). */
export function AudioButton({ clip, text, lang, size = 'lg', className, label, ttsUrl }: Props) {
  const { t, lang: uiLang } = useT();
  const l = lang ?? uiLang;
  const playing = usePlayingId() === `${clip ?? ''}|${text}`;
  const dim = size === 'lg' ? 'h-12 w-12' : 'h-11 w-11';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (playing) stopAudio();
        else void play({ clip, text, lang: l, ttsUrl });
      }}
      aria-label={`${playing ? t('stop') : t('listen')}${label ? `: ${label}` : ''}`}
      aria-pressed={playing}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full border transition-colors duration-fast',
        playing ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary',
        dim,
        className,
      )}
    >
      {playing ? <Square className="h-6 w-6" aria-hidden /> : <Volume2 className="h-7 w-7" aria-hidden />}
    </button>
  );
}
