/**
 * Page-level controller for the optional video guide - ADR-025.
 *
 * This hook is the only thing a citizen page imports. It is deliberately tiny
 * and SDK-free: the WebRTC client, the PCM bridge and the animated stage all
 * live behind `React.lazy(() => import('./AvatarStage'))`, so a citizen who
 * never taps the guide never downloads a byte of it.
 *
 * The split of responsibility is:
 *   - this hook owns *whether* the guide is open (`active`) and whether the
 *     device can afford it (`steppedDown`);
 *   - the stage owns *how* it speaks, and registers handlers here so a page can
 *     call `guide.speak(...)` or `guide.sendUserMessage(...)` without importing
 *     the stage.
 *
 * `steppedDown` is derived, never stored: Lite Mode or an offline browser is a
 * fact about the device, and a stale copy of that fact is how a 2G phone ends up
 * opening a WebRTC session it cannot sustain.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useLiteMode } from '../lite/LiteModeProvider';
import { useOffline } from '../offline/OfflineProvider';
import type {
  AvatarConfig,
  AvatarGuide,
  AvatarSurface,
  AvatarTurn,
  SpeakRequest,
} from './types';

/** Five minutes, per ADR-025: the config is static for a deployment. */
const CONFIG_TTL_MS = 5 * 60 * 1000;

interface CachedConfig {
  value: AvatarConfig;
  at: number;
}

let configCache: CachedConfig | null = null;
let configInflight: Promise<AvatarConfig | null> | null = null;

/** Test seam: forget the cached config so a spec can re-read it. */
export function resetAvatarConfigCache(): void {
  configCache = null;
  configInflight = null;
}

async function loadConfig(): Promise<AvatarConfig | null> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;
  if (configInflight) return configInflight;
  configInflight = (async () => {
    try {
      const value = await api.get<AvatarConfig>('/avatar/config');
      if (!value) return null;
      configCache = { value, at: Date.now() };
      return value;
    } catch {
      // A guide that cannot be configured is simply not offered. This is not an
      // error state for the page: every screen works without it.
      return null;
    } finally {
      configInflight = null;
    }
  })();
  return configInflight;
}

export function useAvatarGuide(surface: AvatarSurface): AvatarGuide {
  const { lite } = useLiteMode();
  const { online } = useOffline();
  const [config, setConfig] = useState<AvatarConfig | null>(configCache?.value ?? null);
  const [active, setActive] = useState(false);
  const handlerRef = useRef<((request: SpeakRequest) => void) | null>(null);
  const sendRef = useRef<((text: string) => void) | null>(null);
  const evidenceRef = useRef<
    ((evidence: { citation?: string | null; notSure?: boolean }) => void) | null
  >(null);
  const turnRef = useRef<((turn: AvatarTurn) => void) | null>(null);
  // The stage is a lazy chunk, so a page can ask the guide to speak before the
  // stage has mounted. Queue that one request instead of dropping it - the
  // greeting is the first thing a citizen hears and it must not be lost to a
  // chunk download.
  const pendingRef = useRef<SpeakRequest | null>(null);
  const pendingSendRef = useRef<string | null>(null);
  const pendingEvidenceRef = useRef<{ citation?: string | null; notSure?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((value) => {
      if (!cancelled && value) setConfig(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const steppedDown = lite || !online;
  const available = config?.enabled === true;
  const conversational = config?.conversational === true;

  // A device that just lost its budget must not keep a video session open. The
  // stage unmounts, its cleanup calls `stopStreaming()`, and the card below
  // swaps to the audio-only notice - no error, no orphaned WebRTC peer.
  useEffect(() => {
    if (steppedDown && active) setActive(false);
  }, [steppedDown, active]);

  const start = useCallback(() => {
    if (!available || steppedDown) return;
    setActive(true);
  }, [available, steppedDown]);

  const stop = useCallback(() => {
    pendingRef.current = null;
    pendingSendRef.current = null;
    pendingEvidenceRef.current = null;
    setActive(false);
  }, []);

  const speak = useCallback((request: SpeakRequest) => {
    if (handlerRef.current) handlerRef.current(request);
    else pendingRef.current = request;
  }, []);

  const sendUserMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (sendRef.current) sendRef.current(trimmed);
    else pendingSendRef.current = trimmed;
  }, []);

  const setEvidence = useCallback(
    (evidence: { citation?: string | null; notSure?: boolean }) => {
      if (evidenceRef.current) evidenceRef.current(evidence);
      else pendingEvidenceRef.current = { ...pendingEvidenceRef.current, ...evidence };
    },
    [],
  );

  const register = useCallback((handler: ((request: SpeakRequest) => void) | null) => {
    handlerRef.current = handler;
    if (!handler) return;
    const queued = pendingRef.current;
    pendingRef.current = null;
    if (queued) handler(queued);
  }, []);

  const registerSend = useCallback((handler: ((text: string) => void) | null) => {
    sendRef.current = handler;
    if (!handler) return;
    const queued = pendingSendRef.current;
    pendingSendRef.current = null;
    if (queued) handler(queued);
  }, []);

  const registerEvidence = useCallback(
    (handler: ((evidence: { citation?: string | null; notSure?: boolean }) => void) | null) => {
      evidenceRef.current = handler;
      if (!handler) return;
      const queued = pendingEvidenceRef.current;
      pendingEvidenceRef.current = null;
      if (queued) handler(queued);
    },
    [],
  );

  const registerTurn = useCallback((listener: ((turn: AvatarTurn) => void) | null) => {
    turnRef.current = listener;
  }, []);

  const emitTurn = useCallback((turn: AvatarTurn) => {
    turnRef.current?.(turn);
  }, []);

  return useMemo<AvatarGuide>(
    () => ({
      config,
      surface,
      active,
      steppedDown,
      available,
      conversational,
      start,
      stop,
      speak,
      sendUserMessage,
      setEvidence,
      _register: register,
      _registerSend: registerSend,
      _registerEvidence: registerEvidence,
      _registerTurn: registerTurn,
      _emitTurn: emitTurn,
    }),
    [
      config,
      surface,
      active,
      steppedDown,
      available,
      conversational,
      start,
      stop,
      speak,
      sendUserMessage,
      setEvidence,
      register,
      registerSend,
      registerEvidence,
      registerTurn,
      emitTurn,
    ],
  );
}
