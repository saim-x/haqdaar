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
      <img
        src={showLevel ? '/brand/saima-stage.webp' : '/brand/saima-avatar.webp'}
        alt=""
        aria-hidden
        loading="eager"
        decoding="async"
        className="h-full w-full object-cover object-top"
      />
      <div
        className={`pointer-events-none absolute inset-0 border-2 transition-colors ${
          speaking ? tone.ring : 'border-transparent'
        }`}
        aria-hidden
      />
      {showLevel && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex items-end justify-center gap-1" aria-hidden>
          <div className="flex items-end gap-1 rounded-full bg-ink/45 px-2.5 py-1.5 backdrop-blur-sm">
            {[0, 1, 2, 3, 4].map((bar) => (
              <span
                key={bar}
                className={`w-1 rounded-full bg-white ${speaking ? 'avatar-wave' : 'opacity-45'}`}
                style={{
                  height: `${8 + (bar % 3) * 5}px`,
                  animationDelay: `${bar * 110}ms`,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
