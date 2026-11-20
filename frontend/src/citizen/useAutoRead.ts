import { useEffect } from 'react';
import { play, stopAudio } from '../shared/audio';
import { useT } from '../shared/i18n';
import { useSettings } from '../shared/settings';

/** Plays the screen prompt once on arrival when "Auto-read" is on (docs/11 §2.2). */
export function useAutoRead(clip: string | undefined, text: string, deps: unknown[] = []) {
  const { autoRead } = useSettings();
  const { lang } = useT();
  useEffect(() => {
    if (!autoRead || !text) return;
    // Small delay: let the screen paint and avoid overlapping a previous prompt.
    const id = setTimeout(() => void play({ clip, text, lang }), 350);
    return () => {
      clearTimeout(id);
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead, lang, clip, text, ...deps]);
}
