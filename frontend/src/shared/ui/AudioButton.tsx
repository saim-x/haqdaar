import { useId } from 'react';
import { useAudio } from '../audio/AudioProvider';
import { useI18n } from '../i18n/I18nProvider';
import { IconPause, IconSpeaker, IconSpinner } from './Icons';

interface AudioButtonProps {
  /** Manifest key under `public/audio/ur/`. */
  audioKey?: string | null;
  /** Urdu text used for dynamic TTS when no pre-cached MP3 exists. */
  text?: string | null;
  label?: string;
  size?: 'md' | 'lg';
  /** `onDark` for use inside a filled semantic band. */
  tone?: 'default' | 'onDark';
  /**
   * `circle` is the screen-level affordance docs/11 §2.2 asks for: a hairline
   * ring, one per screen. `quiet` is for the speaker that sits beside every
   * field in a review list - ten rings down one column is a wall of circles,
   * and the ring is what makes the screen-level button the prominent one.
   * Both keep the 48 px target.
   */
  variant?: 'circle' | 'quiet';
  className?: string;
}

/**
 * The speaker affordance required on every citizen screen (docs/11 §2.2).
 * 48×48 px minimum, 56×56 for the large variant, always present, always
 * silent-safe.
 *
 * It is a hairline circle, not a 2px teal ring: it appears on every screen, so
 * it must not compete with the one primary action. While speaking it swaps to a
 * pause glyph and a filled surface - a state change, not a looping pulse.
 */
export function AudioButton({
  audioKey,
  text,
  label,
  size = 'md',
  tone = 'default',
  variant = 'circle',
  className = '',
}: AudioButtonProps) {
  const id = useId();
  const { play, activeControl, loadingControl, stop } = useAudio();
  const speaking = activeControl === id;
  const loading = loadingControl === id;
  const { t } = useI18n();
  const accessibleLabel = label ?? t('common.listen');
  const dimension = size === 'lg' ? 'h-14 w-14' : 'h-12 w-12';

  const skin =
    tone === 'onDark'
      ? speaking
        ? 'border-white bg-white text-ink'
        : 'border-white/40 bg-white/15 text-white hover:bg-white/25'
      : variant === 'quiet'
        ? speaking
          ? 'border-transparent bg-accent text-white'
          : 'border-transparent bg-transparent text-ink-3 hover:bg-raised hover:text-accent-ink'
        : speaking
          ? 'border-accent bg-accent text-white'
          : 'border-ink/[0.14] bg-card text-accent-ink hover:bg-accent-wash';

  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-pressed={speaking || loading}
      aria-busy={loading}
      title={accessibleLabel}
      onClick={() => (speaking ? stop() : void play(audioKey, text, id))}
      className={`${dimension} press inline-flex shrink-0 items-center justify-center rounded-full border ${skin} ${className}`}
    >
      {loading ? <IconSpinner size={size === 'lg' ? 22 : 18} /> : speaking ? <IconPause size={size === 'lg' ? 22 : 18} /> : <IconSpeaker size={size === 'lg' ? 24 : 20} />}
    </button>
  );
}
