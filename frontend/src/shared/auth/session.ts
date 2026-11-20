import { clearEtagCache } from '../api/client';
import { auth as authApi } from '../api/endpoints';
import type { Family, TokenPayload } from '../api/types';
import { stopAudio } from '../audio';
import { queryClient } from '../queryClient';
import { authStore } from './store';

export async function completeLogin(tokens: TokenPayload) {
  queryClient.clear();
  clearEtagCache();
  authStore.set({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    user: tokens.user,
    citizenId: tokens.citizen_id ?? null,
    actingFor: null,
    tenant: null,
  });
  try {
    const me = await authApi.me();
    authStore.set({ user: me.user, tenant: me.tenant, citizenId: me.citizen?.id ?? tokens.citizen_id ?? null });
  } catch {
    /* /auth/me is a nicety; the token payload is enough to route */
  }
}

export async function logout() {
  const { refreshToken } = authStore.get();
  stopAudio();
  if (refreshToken) authApi.logout(refreshToken).catch(() => undefined);
  authStore.clear();
  queryClient.clear();
  clearEtagCache();
}

/**
 * Helper Mode safe switch (docs/11 §4.3): synchronously wipe every cached query
 * and in-memory answer of the previous family BEFORE the new act-for id is set,
 * so nothing from family A can render while helping family B.
 */
export function switchFamily(f: Pick<Family, 'citizen_id' | 'full_name' | 'avatar_color'> | null) {
  stopAudio();
  queryClient.cancelQueries();
  queryClient.clear();
  clearEtagCache();
  authStore.set({
    actingFor: f ? { citizenId: f.citizen_id, name: f.full_name, avatarColor: f.avatar_color } : null,
  });
}

/** Citizen whose data the current screen shows (self, or the family a helper acts for). */
export function currentCitizenId(): string | null {
  const s = authStore.get();
  return s.user?.role === 'HELPER' ? s.actingFor?.citizenId ?? null : s.citizenId;
}
