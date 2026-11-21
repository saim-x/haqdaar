/**
 * The video guide engine - ADR-025.
 *
 * Three modes, one interface:
 *
 *  - `conversational` (live): the vendor listens to the citizen's own Urdu over
 *    WebRTC and answers in its own voice. This is the mode that gives a
 *    low-literacy citizen a real conversation, and the only one that needs no
 *    Deepgram or OpenAI key of ours. The vendor is grounded by a system prompt
 *    the backend builds from the live active rule version.
 *  - `passthrough` (live): the avatar is a mouth only. We stream our own Urdu
 *    audio into it as 24 kHz `pcm_s16le`; the vendor never receives a question,
 *    a case, or a CNIC.
 *  - `fake` (dev/CI/E2E): an animated local guide plus real `<audio>` playback
 *    of the same clips. Zero vendor minutes, identical citizen flow.
 *
 * `degraded` is a fourth state, not an error: the vendor refused or timed out and
 * the stage became an audio-only companion. It keeps working.
 *
 * Credit discipline is enforced here, not in the UI:
 *  - nothing connects until `connect()` is called from a tap;
 *  - 90 s of silence disconnects;
 *  - a 165 s hard cap disconnects, with a 25 s warning and a one-tap renew;
 *  - unmount, route change and a hidden tab all disconnect.
 *
 * The SDK is imported dynamically inside `connect()`. A citizen who never taps
 * the guide never downloads it, which is what keeps the entry bundle inside the
 * 150 KB budget.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAudioInputStream, AnamClient } from '@anam-ai/js-sdk';
import { useAudio } from '../audio/AudioProvider';
import { audioUrl } from '../audio/manifest';
import { getAccessToken } from '../auth/session';
import { api } from '../api/client';
import { decodeToPcm24kMono, fetchPcm, splitForTts, streamPcmToAnam } from './pcmBridge';
import type {
  AvatarConfig,
  AvatarMode,
  AvatarMood,
  AvatarProvider,
  AvatarSessionResponse,
  AvatarState,
  AvatarSurface,
  AvatarTurn,
  SpeakRequest,
} from './types';

