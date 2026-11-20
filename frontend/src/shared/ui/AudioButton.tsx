import { useAudio } from '../audio/AudioProvider';
import { useI18n } from '../i18n/I18nProvider';
import { IconSpeaker } from './Icons';

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
 * The 🔊 affordance required on every citizen screen (docs/11 §2.2).
 * 56×56 px minimum, always present, always silent-safe.
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
      title={accessibleLabel}
      onClick={() => (speaking ? stop() : void play(audioKey, text))}
      className={`${dimension} inline-flex shrink-0 items-center justify-center rounded-full border-2 border-teal-600 bg-white text-teal-700 transition active:scale-95 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
        speaking ? 'animate-pulse bg-teal-50' : ''
      } ${className}`}
    >
      <IconSpeaker size={size === 'lg' ? 28 : 24} />
    </button>
  );
}
