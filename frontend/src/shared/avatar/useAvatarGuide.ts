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

