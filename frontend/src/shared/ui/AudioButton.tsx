import { useAudio } from '../audio/AudioProvider';
import { useI18n } from '../i18n/I18nProvider';
import { IconPause, IconSpeaker } from './Icons';

interface AudioButtonProps {
  /** Manifest key under `public/audio/ur/`. */
  audioKey?: string | null;
  /** Urdu text used for dynamic TTS when no pre-cached MP3 exists. */
  text?: string | null;
  label?: string;
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * The speaker affordance required on every citizen screen (docs/11 §2.2).
 * 48×48 px minimum, 56×56 for the large variant, always present, always
 * silent-safe.
 *
 * It is a hairline circle, not a 2px teal ring: it appears on every screen, so
 * it must not compete with the one primary action. While speaking it swaps to a
 * pause glyph and a filled surface — a state change, not a looping pulse.
 */
export function AudioButton({ audioKey, text, label, size = 'md', className = '' }: AudioButtonProps) {
  const { play, speaking, stop } = useAudio();
  const { t } = useI18n();
  const accessibleLabel = label ?? t('common.listen');
  const dimension = size === 'lg' ? 'h-14 w-14' : 'h-12 w-12';

  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-pressed={speaking}
      title={accessibleLabel}
      onClick={() => (speaking ? stop() : void play(audioKey, text))}
      className={`${dimension} press inline-flex shrink-0 items-center justify-center rounded-full border ${
        speaking
          ? 'border-accent bg-accent text-white'
          : 'border-ink/[0.14] bg-card text-accent-ink hover:bg-accent-wash'
      } ${className}`}
    >
      {speaking ? <IconPause size={size === 'lg' ? 22 : 18} /> : <IconSpeaker size={size === 'lg' ? 24 : 20} />}
    </button>
  );
}
