/**
 * The guide as a home-page surface, not a row in a list - ADR-025.
 *
 * The video guide used to be reachable only from inside "Ask a question", which
 * buried the one feature built for citizens who cannot read. This tile is the
 * invitation: a portrait, one sentence, and a 56px button.
 *
 * It is a *different invitation*, not a second state machine. Once the citizen
 * taps, this hands off to `AvatarToggleCard`, which owns the stage, the
 * audio-only fallback and the lazy WebRTC chunk. Nothing about the session
 * lifecycle is duplicated here, so the two surfaces cannot drift apart.
 */

import { useId } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { IconMic, IconPlay } from '../ui/Icons';
import { TapButton } from '../ui/TapButton';
import { AvatarToggleCard } from './AvatarToggleCard';
import { GuideFace } from './GuideFace';
import type { AvatarGuide } from './types';

interface AvatarHeroProps {
  guide: AvatarGuide;
  className?: string;
}

export function AvatarHero({ guide, className = '' }: AvatarHeroProps) {
  const { t, pick } = useI18n();
  const noticeId = useId();

  if (!guide.available) return null;

  // Open, or the device cannot afford video: the card owns both. It renders the
  // stage when active and the audio-only reassurance when stepped down.
  if (guide.active || guide.steppedDown) {
    return <AvatarToggleCard guide={guide} className={className} />;
  }

  const offersMicrophone = guide.conversational && guide.config?.provider === 'anam';
  const personaName =
    pick(guide.config?.persona_name_ur, guide.config?.persona_name_en) || t('avatar.name');
  const simulated = guide.config?.provider === 'fake';

  return (
    <section className={`card overflow-hidden ${className}`} data-testid="avatar-hero">
      <div className="flex items-start gap-3.5 p-4">
        {/* A squircle, not a circle: the round portrait is the default every
            product reaches for, and this one is a character, not an account. */}
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-panel border border-accent/20">
          <GuideFace showLevel={false} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-meta text-ink-3">{t('avatar.governance')}</p>
          <h2 className="mt-0.5 text-lead font-medium leading-[1.4] text-ink">{personaName}</h2>
          <p className="mt-1 text-caption leading-[1.7] text-ink-2">{t('home.guidePitch')}</p>
        </div>
      </div>

      {offersMicrophone && (
        <p id={noticeId} className="px-4 pb-2.5 text-meta leading-[1.7] text-ink-3">
          {t('avatar.micPrivacy')}
        </p>
      )}

      <div className="px-4 pb-4">
        <TapButton
          size="primary"
          block
          onClick={() => guide.start(offersMicrophone)}
          aria-describedby={offersMicrophone ? noticeId : undefined}
          data-testid="avatar-start"
          icon={offersMicrophone ? <IconMic size={18} /> : <IconPlay size={18} />}
        >
          {t('home.guideCta')}
        </TapButton>
      </div>

      {simulated ? (
        <p
          data-testid="avatar-simulated"
          className="border-t border-ink/[0.08] px-4 py-2 text-meta text-ink-3"
        >
          {t('avatar.simulated')}
        </p>
      ) : (
        guide.conversational && (
          <p
            data-testid="avatar-live-badge"
            className="flex items-center gap-1.5 border-t border-ink/[0.08] px-4 py-2 text-meta text-accent-ink"
          >
            <span className="live-dot bg-accent" aria-hidden />
            {t('avatar.liveConversation')}
          </p>
        )
      )}
    </section>
  );
}
