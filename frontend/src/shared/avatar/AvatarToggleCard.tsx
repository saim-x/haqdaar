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

import { Suspense, lazy } from 'react';
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
