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

/**
 * The local portrait. Deliberately abstract: a headscarf silhouette, not a
 * likeness of a real person - this is a prototype and inventing a face for a
 * fictional officer would be the wrong kind of realism.
 */
function GuideFace({ mood, speaking }: { mood: AvatarMood; speaking: boolean }) {
  const tone = MOOD[mood];
  return (
    <div className="relative h-full w-full overflow-hidden bg-paper">
      <div className={`absolute inset-0 bg-gradient-to-b ${tone.wash} to-paper`} aria-hidden />
      <div
        className={`avatar-halo absolute left-1/2 top-1/2 h-[62%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${tone.ring}`}
        aria-hidden
      />
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full text-accent-ink"
        aria-hidden
        preserveAspectRatio="xMidYMax meet"
      >
        {/* shoulders */}
        <path d="M28 200c0-40 32-72 72-72s72 32 72 72z" fill="currentColor" opacity="0.14" />
        {/* headscarf */}
        <path
          d="M100 30c-27 0-46 21-46 48 0 21 9 36 9 36h74s9-15 9-36c0-27-19-48-46-48z"
          fill="currentColor"
          opacity="0.26"
        />
        {/* face */}
        <ellipse cx="100" cy="84" rx="25" ry="31" fill="currentColor" opacity="0.42" />
        {/* eyes */}
        <ellipse cx="90" cy="80" rx="2.6" ry="3.2" fill="#FFFDF8" opacity="0.9" />
        <ellipse cx="110" cy="80" rx="2.6" ry="3.2" fill="#FFFDF8" opacity="0.9" />
        {/* mouth: the only part that moves */}
        <rect
          x="94"
          y="96"
          width="12"
          height={speaking ? 7 : 2.4}
          rx="3.4"
          fill="#FFFDF8"
          opacity="0.85"
          style={{ transition: 'height 160ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      {/* voice level */}
      <div className="absolute inset-x-0 bottom-3 flex items-end justify-center gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`w-1 rounded-full ${tone.dot} ${speaking ? 'avatar-wave' : 'opacity-30'}`}
            style={{
              height: `${10 + (bar % 3) * 6}px`,
              animationDelay: `${bar * 110}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The live WebRTC surface.
 *
 * Memoised on purpose: the caption changes on every streamed token, and without
 * this the whole stage - including this element and its props - is reconciled
 * several times a second while the vendor is decoding video. The element's own
 * props never change mid-session, so it should never be part of that work.
 *
 * `avatar-video` promotes it to its own compositor layer, so the caption text
 * reflowing underneath cannot force the video to repaint.
 */
const LiveVideo = memo(function LiveVideo({ videoId, muted }: { videoId: string; muted: boolean }) {
  return (
    <video
      id={videoId}
      data-testid="avatar-video"
      autoPlay
      playsInline
      muted={muted}
      disablePictureInPicture
      className="avatar-video h-full w-full object-cover"
    />
  );
});

