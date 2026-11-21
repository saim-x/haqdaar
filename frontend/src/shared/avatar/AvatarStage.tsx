/**
 * The guide's face - ADR-025. Lazy-loaded; never in the citizen entry graph.
 *
 * What this component is allowed to say is decided elsewhere. It renders a
 * caption, a mood, and a citation chip, and it owns exactly three controls:
 * mute, stop-speaking, and end. It has no access to a case, a rule, or a
 * decision, which is the point: the face is a mouth.
 *
 * In `fake` mode (dev, CI, Playwright) there is no WebRTC peer at all - the
 * portrait below is drawn locally and the voice comes from the same cached Urdu
 * MP3s the rest of the app uses. That is what makes the whole flow testable at
 * zero vendor cost.
 */

import { memo, useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { IconMic, IconMicOff, IconPause, IconRefresh, IconSpeaker, IconXCircle } from '../ui/Icons';
import type { AvatarGuide, AvatarMood } from './types';
import { useAnamAvatar } from './useAnamAvatar';

interface AvatarStageProps {
  guide: AvatarGuide;
  /** PiP dock: shorter stage, same controls. */
  compact?: boolean;
}

/**
 * Mood → colour. `not_sure` is amber and `warning` is red because those two are
 * the only moods that carry meaning: an honest abstention and an anti-scam
 * alert. The rest are warmth, and warmth does not need a legend.
 */
const MOOD: Record<AvatarMood, { ring: string; wash: string; dot: string }> = {
  calm: { ring: 'border-accent/35', wash: 'from-accent-wash', dot: 'bg-accent' },
  listening: { ring: 'border-accent/45', wash: 'from-accent-wash', dot: 'bg-accent' },
  thinking: { ring: 'border-info/35', wash: 'from-info-wash', dot: 'bg-info' },
  happy: { ring: 'border-positive/40', wash: 'from-positive-wash', dot: 'bg-positive' },
  reassuring: { ring: 'border-accent/35', wash: 'from-accent-wash', dot: 'bg-accent' },
  warning: { ring: 'border-negative/45', wash: 'from-negative-wash', dot: 'bg-negative' },
  not_sure: { ring: 'border-warn/45', wash: 'from-warn-wash', dot: 'bg-warn' },
};

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

