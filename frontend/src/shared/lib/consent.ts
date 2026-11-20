import type { ConsentGrant } from '../api/types';

/**
 * Human label for a grant's recipient. The server embeds `recipient_tenant` /
 * `recipient_user` on `GET /consent/grants`, so the UI never resolves ids itself.
 */
export function grantRecipientLabel(grant: ConsentGrant, lang: 'ur' | 'en'): string {
  if (grant.recipient_type === 'DEPARTMENT') {
    const tenant = grant.recipient_tenant;
    if (!tenant) return lang === 'ur' ? 'محکمہ' : 'Department';
    return lang === 'ur' ? tenant.name_ur : tenant.name;
  }
  const user = grant.recipient_user;
  if (!user) return lang === 'ur' ? 'مددگار' : 'Helper';
  return user.full_name;
}

/** Secondary line: the department code, or the helper's role. */
export function grantRecipientSubLabel(grant: ConsentGrant): string | null {
  if (grant.recipient_type === 'DEPARTMENT') return grant.recipient_tenant?.code ?? null;
  return null;
}
