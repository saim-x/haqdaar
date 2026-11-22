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
import { GuideFace, MOOD } from './GuideFace';
import type { AvatarGuide } from './types';
import { useAnamAvatar } from './useAnamAvatar';

interface AvatarStageProps {
  guide: AvatarGuide;
  /** PiP dock: shorter stage, same controls. */
  compact?: boolean;
}

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

export default function AvatarStage({ guide, compact = false }: AvatarStageProps) {
  const { t } = useI18n();
  const avatar = useAnamAvatar(guide.config, guide.surface, guide.microphoneAllowed);
  const { connect, disconnect, speak, state } = avatar;
  const startedRef = useRef(false);

  // The page drives the guide through these handlers, so a page never imports
  // the stage or the SDK just to make Saima say something or to answer her.
  useEffect(() => {
    guide._register(speak);
    return () => guide._register(null);
  }, [guide, speak]);

  useEffect(() => {
    guide._registerSend(avatar.sendTextToAvatar);
    return () => guide._registerSend(null);
  }, [guide, avatar.sendTextToAvatar]);

  // The evidence chips are driven by the page's grounded `/rag/ask` result, not
  // by speech: in conversational mode the vendor owns the voice, so the citation
  // and the abstention badge arrive on their own channel.
  useEffect(() => {
    guide._registerEvidence(avatar.setEvidence);
    return () => guide._registerEvidence(null);
  }, [guide, avatar.setEvidence]);

  // Every live turn the vendor reports goes back to the page, so the transcript
  // and the guided-action chip stay in step with what was actually said.
  useEffect(() => {
    avatar.onTurn((turn) => guide._emitTurn(turn));
    return () => avatar.onTurn(null);
  }, [avatar, guide]);

  // Mounting the stage *is* the citizen's tap: `AvatarToggleCard` only renders
  // it after an explicit press, so connecting here never spends a credit on a
  // page load.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void connect();
  }, [connect]);

  const live = avatar.provider === 'anam' && state !== 'degraded';
  const speaking = state === 'speaking';
  const tone = MOOD[avatar.mood];
  const connecting = state === 'connecting';

  return (
    <section
      className="card enter overflow-hidden"
      data-testid="avatar-stage"
      data-state={state}
      data-mood={avatar.mood}
      data-provider={avatar.provider}
      aria-label={t('avatar.name')}
    >
      {/* Trust bar: what this is, how long it has left, and how to renew. */}
      <div className="flex items-center gap-2 border-b border-ink/[0.08] px-3 py-2">
        <span className={`live-dot ${tone.dot} ${speaking ? 'animate-breathe' : ''}`} aria-hidden />
        <span className="text-meta font-medium text-ink-2" data-testid="avatar-governance">
          {t('avatar.governance')}
        </span>
        {avatar.simulated && (
          <span
            data-testid="avatar-simulated"
            className="rounded-full bg-raised px-2 py-0.5 text-meta text-ink-3"
          >
            {t('avatar.simulated')}
          </span>
        )}
        <span className="ms-auto num font-mono text-meta text-ink-3" data-testid="avatar-countdown">
          {clock(avatar.secondsLeft)}
        </span>
        {avatar.warning && (
          <button
            type="button"
            onClick={() => void avatar.renew()}
            data-testid="avatar-renew"
            className="press inline-flex min-h-tap items-center gap-1 rounded-control border border-accent/40 bg-accent-wash px-2.5 text-meta font-medium text-accent-ink hover:bg-accent/15"
          >
            <IconRefresh size={14} />
            {t('avatar.renew')}
          </button>
        )}
      </div>

      {/* The stage itself. */}
      <div
        className={`relative w-full overflow-hidden bg-ink ${compact ? 'aspect-[4/3]' : 'aspect-[4/3] sm:aspect-[16/10]'}`}
      >
        {live ? (
          <LiveVideo videoId={avatar.videoId} muted={avatar.muted} />
        ) : (
          <GuideFace mood={avatar.mood} speaking={speaking} />
        )}

        {connecting && (
          <div className="absolute inset-0 grid place-items-center bg-paper/85" role="status">
            <p className="text-caption font-medium text-ink-2">{t('avatar.connecting')}</p>
          </div>
        )}

        {avatar.mood === 'thinking' && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="avatar-shimmer h-full w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </div>
        )}

        {/* The citizen must be able to see that Saima is listening to her voice. */}
        {avatar.conversational && avatar.mood === 'listening' && (
          <div
            data-testid="avatar-listening"
            className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-meta font-medium text-accent-ink shadow-lift">
              <span className="live-dot animate-breathe bg-accent" aria-hidden />
              {t('avatar.listening')}
            </span>
          </div>
        )}

        {/* The two chips that carry meaning. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1.5">
          {avatar.notSure && (
            <span
              data-testid="avatar-not-sure"
              className="rounded-full border border-warn/40 bg-warn-wash px-2.5 py-1 text-meta font-medium text-warn"
            >
              {t('avatar.notSure')}
            </span>
          )}
          {avatar.citation && (
            <span
              data-testid="avatar-citation"
              className="max-w-full truncate rounded-full border border-accent/35 bg-card/95 px-2.5 py-1 text-meta font-medium text-accent-ink"
            >
              {t('avatar.citation')} · {avatar.citation}
            </span>
          )}
        </div>
      </div>

      {/* Caption bar. Nastaliq needs the extra leading, so it is set here. */}
      <div className="border-t border-ink/[0.08] px-3 py-2.5">
        {state === 'degraded' && (
          <p
            data-testid="avatar-audio-only"
            className="mb-2 rounded-control bg-warn-wash px-2.5 py-2 text-meta font-medium leading-[1.8] text-warn"
          >
            {avatar.degradedMessage ?? t('avatar.degraded')}
          </p>
        )}
        {avatar.micDenied && (
          <p
            data-testid="avatar-mic-denied"
            className="mb-2 rounded-control bg-warn-wash px-2.5 py-2 text-meta font-medium leading-[1.8] text-warn"
          >
            {t('avatar.micDenied')}
          </p>
        )}
        <p
          data-testid="avatar-caption"
          className="min-h-[2.6em] text-body leading-[1.9] text-ink"
          dir="auto"
          aria-live="polite"
        >
          {avatar.caption ||
            (speaking
              ? t('avatar.speaking')
              : connecting
                ? t('avatar.connecting')
                : avatar.conversational && !avatar.micMuted
                  ? t('avatar.micPrompt')
                  : t('avatar.ready'))}
        </p>
      </div>

      {/* Controls. Every target is at least 48 px. */}
      <div className="flex items-center gap-2 border-t border-ink/[0.08] px-3 py-2.5">
        {avatar.conversational && (
          <button
            type="button"
            onClick={avatar.toggleMic}
            data-testid="avatar-mic"
            aria-pressed={!avatar.micMuted}
            aria-label={avatar.micMuted ? t('avatar.micOff') : t('avatar.micOn')}
            title={avatar.micMuted ? t('avatar.micOff') : t('avatar.micOn')}
            className={`press inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-control border px-2.5 ${
              avatar.micMuted
                ? 'border-transparent bg-raised text-ink-3'
                : 'border-accent/45 bg-accent-wash text-accent-ink hover:bg-accent/15'
            }`}
          >
            {avatar.micMuted ? <IconMicOff size={18} /> : <IconMic size={18} />}
            <span className="text-meta font-medium">
              {avatar.micMuted ? t('avatar.micOff') : t('avatar.micOn')}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={avatar.toggleMute}
          data-testid="avatar-mute"
          aria-pressed={avatar.muted}
          aria-label={avatar.muted ? t('avatar.unmute') : t('avatar.mute')}
          title={avatar.muted ? t('avatar.unmute') : t('avatar.mute')}
          className={`press grid h-tap w-tap shrink-0 place-items-center rounded-control border ${
            avatar.muted
              ? 'border-transparent bg-raised text-ink-3'
              : 'border-ink/[0.12] bg-card text-accent-ink hover:bg-accent-wash'
          }`}
        >
          <IconSpeaker size={18} />
        </button>
        <button
          type="button"
          onClick={avatar.interrupt}
          data-testid="avatar-interrupt"
          disabled={!speaking}
          aria-label={t('avatar.interrupt')}
          title={t('avatar.interrupt')}
          className="press grid h-tap w-tap shrink-0 place-items-center rounded-control border border-ink/[0.12] bg-card text-ink-2 hover:bg-raised disabled:border-transparent disabled:bg-raised disabled:text-ink-3"
        >
          <IconPause size={18} />
        </button>
        <button
          type="button"
          onClick={() => {
            void disconnect();
            guide.stop();
          }}
          data-testid="avatar-end"
          className="press ms-auto inline-flex min-h-tap items-center gap-1.5 rounded-control border border-ink/[0.12] bg-card px-3 text-caption font-medium text-ink-2 hover:bg-raised"
        >
          <IconXCircle size={16} />
          {t('avatar.stop')}
        </button>
      </div>
    </section>
  );
}
