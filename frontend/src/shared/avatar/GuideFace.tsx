/**
 * The guide's portrait, and the mood palette that colours it.
 *
 * This lives outside `AvatarStage` on purpose. The stage is lazy-loaded because
 * it drags in the WebRTC client; the portrait is a few hundred bytes of inline
 * SVG and the home page wants to show it as the invitation. Keeping the face in
 * its own module lets the entry bundle draw the guide without ever importing
 * the stage, which is the whole point of the ADR-025 split.
 *
 * The face is deliberately abstract: a headscarf silhouette, not a likeness of
 * a real person. This is a prototype, and inventing a face for a fictional
 * officer would be the wrong kind of realism.
 */

import type { AvatarMood } from './types';

/**
 * Mood → colour. `not_sure` is amber and `warning` is red because those two are
 * the only moods that carry meaning: an honest abstention and an anti-scam
 * alert. The rest are warmth, and warmth does not need a legend.
 */
export const MOOD: Record<AvatarMood, { ring: string; wash: string; dot: string }> = {
  calm: { ring: 'border-accent/35', wash: 'from-accent-wash', dot: 'bg-accent' },
  listening: { ring: 'border-accent/45', wash: 'from-accent-wash', dot: 'bg-accent' },
  thinking: { ring: 'border-info/35', wash: 'from-info-wash', dot: 'bg-info' },
  happy: { ring: 'border-positive/40', wash: 'from-positive-wash', dot: 'bg-positive' },
  reassuring: { ring: 'border-accent/35', wash: 'from-accent-wash', dot: 'bg-accent' },
  warning: { ring: 'border-negative/45', wash: 'from-negative-wash', dot: 'bg-negative' },
  not_sure: { ring: 'border-warn/45', wash: 'from-warn-wash', dot: 'bg-warn' },
};

interface GuideFaceProps {
  mood?: AvatarMood;
  /** Opens the mouth and animates the level bars. */
  speaking?: boolean;
  /** Hide the voice-level bars where the portrait is a small medallion. */
  showLevel?: boolean;
}

export function GuideFace({ mood = 'calm', speaking = false, showLevel = true }: GuideFaceProps) {
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
      {showLevel && (
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
      )}
    </div>
  );
}
