/**
 * Floating guide bubble for the guided wizard - ADR-025.
 *
 * The wizard is a full-screen form; a video panel that pushes the fields down
 * would be actively harmful. So the guide lives in a corner, collapsed by
 * default, and expands into a docked card the citizen can close again without
 * losing a single typed character.
 *
 * Hidden entirely in Lite Mode and offline: on a 2G connection the wizard's own
 * pre-cached step prompts already speak, and a floating video button would be an
 * invitation to spend data the citizen does not have.
 *
 * The offset clears the wizard's own fixed Back/Next bar (~64 px plus the safe
 * area). Sitting at `bottom-5` put the bubble underneath that bar, where it was
 * visible but not tappable - a control the citizen can see and cannot press is
 * worse than no control at all.
 */

import { Suspense, lazy } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { IconChevronDown, IconPlay } from '../ui/Icons';
import type { AvatarGuide } from './types';

const AvatarStage = lazy(() => import('./AvatarStage'));

export function AvatarPiPBubble({ guide }: { guide: AvatarGuide }) {
  const { t } = useI18n();

  if (!guide.available || guide.steppedDown) return null;

  if (guide.active) {
    return (
      <div
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] start-4 z-30 w-[min(320px,calc(100vw-2rem))]"
        data-testid="avatar-pip-open"
      >
        <Suspense
          fallback={
            <div className="card grid min-h-[96px] place-items-center px-4 py-5" role="status">
              <p className="text-caption text-ink-3">{t('avatar.connecting')}</p>
            </div>
          }
        >
          <AvatarStage guide={guide} compact />
        </Suspense>
        <button
          type="button"
          onClick={guide.stop}
          data-testid="avatar-pip-collapse"
          aria-label={t('avatar.pipClose')}
          title={t('avatar.pipClose')}
          className="press absolute -top-2 end-0 grid h-8 w-8 place-items-center rounded-full border border-ink/[0.12] bg-card text-ink-2 shadow-hair hover:bg-raised"
        >
          <IconChevronDown size={16} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={guide.start}
      data-testid="avatar-pip"
      aria-label={t('avatar.pipOpen')}
      title={t('avatar.pipOpen')}
      className="press fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] start-4 z-30 grid h-14 w-14 place-items-center rounded-full border border-accent/30 bg-card text-accent-ink shadow-lift hover:bg-accent-wash"
    >
      <IconPlay size={20} />
    </button>
  );
}
