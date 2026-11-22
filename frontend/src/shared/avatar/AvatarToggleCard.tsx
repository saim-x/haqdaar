/**
 * The opt-in card for the video guide - ADR-025.
 *
 * This is the only avatar file a citizen page imports directly, so it stays
 * small and SDK-free: `AvatarStage` (and with it the WebRTC client) is behind
 * `React.lazy`, which is what keeps `@anam-ai/js-sdk` out of the entry bundle.
 *
 * Three states, and the third is the interesting one:
 *   1. the guide is available and closed  -> an invitation, one tap to open;
 *   2. the guide is open                  -> the stage;
 *   3. the device cannot afford video     -> an audio-only notice, no error.
 *
 * State 3 is not a failure path. Lite Mode and a 2G connection are the normal
 * condition for the citizens this product is for, so the notice is written as a
 * reassurance ("the audio guide is active"), never as an apology.
 */

import { Suspense, lazy, useId } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useOffline } from '../offline/OfflineProvider';
import { IconChevron, IconPlay, IconSpeaker } from '../ui/Icons';
import type { AvatarGuide } from './types';

const AvatarStage = lazy(() => import('./AvatarStage'));

interface AvatarToggleCardProps {
  guide: AvatarGuide;
  className?: string;
}

export function AvatarToggleCard({ guide, className = '' }: AvatarToggleCardProps) {
  const { t } = useI18n();
  const { online } = useOffline();
  const noticeId = useId();
  const offersMicrophone = guide.conversational && guide.config?.provider === 'anam';

  if (!guide.available) return null;

  if (guide.steppedDown) {
    const offline = !online;
    return (
      <div
        className={`card flex items-start gap-2.5 px-3.5 py-3 ${className}`}
        data-testid="avatar-audio-only-notice"
      >
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
          <IconSpeaker size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-medium leading-[1.7] text-ink">
            {offline ? t('avatar.offlineTitle') : t('avatar.liteTitle')}
          </p>
          <p className="mt-0.5 text-meta leading-[1.8] text-ink-3">
            {offline ? t('avatar.offlineBody') : t('avatar.liteBody')}
          </p>
        </div>
      </div>
    );
  }

  if (guide.active) {
    return (
      <div className={className}>
        <Suspense
          fallback={
            <div className="card grid min-h-[120px] place-items-center px-4 py-6" role="status">
              <p className="text-caption text-ink-3">{t('avatar.connecting')}</p>
            </div>
          }
        >
          <AvatarStage guide={guide} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={`card overflow-hidden ${className}`} data-testid="avatar-cta">
      {offersMicrophone && (
        <p id={noticeId} className="px-3.5 pt-3 text-meta leading-[1.7] text-ink-2">
          {t('avatar.micPrivacy')}
        </p>
      )}
      <button
        type="button"
        onClick={() => guide.start(offersMicrophone)}
        aria-describedby={offersMicrophone ? noticeId : undefined}
        data-testid="avatar-start"
        className="press flex min-h-primary w-full items-center gap-3 px-3.5 py-3 text-start hover:bg-accent-wash/60"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-wash text-accent-ink">
          <IconPlay size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium leading-[1.6] text-ink">
            {offersMicrophone ? t('avatar.startWithMic') : t('avatar.cta')}
          </span>
          <span className="mt-0.5 block text-meta leading-[1.7] text-ink-3">{t('avatar.ctaHint')}</span>
        </span>
        <IconChevron size={16} className="shrink-0 text-ink-3" />
      </button>
      {guide.conversational && (
        <p
          data-testid="avatar-live-badge"
          className="flex items-center gap-1.5 border-t border-ink/[0.08] px-3.5 py-1.5 text-meta text-accent-ink"
        >
          <span className="live-dot bg-accent" aria-hidden />
          {t('avatar.liveConversation')}
        </p>
      )}
      {guide.config?.provider === 'fake' && (
        <p
          data-testid="avatar-simulated"
          className="border-t border-ink/[0.08] px-3.5 py-1.5 text-meta text-ink-3"
        >
          {t('avatar.simulated')}
        </p>
      )}
    </div>
  );
}
