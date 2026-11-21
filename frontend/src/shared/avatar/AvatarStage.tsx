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

