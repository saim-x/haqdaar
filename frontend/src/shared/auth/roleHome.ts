import type { Role, User } from '../api/types';

/** Where each role lands after sign-in (AC-01.1). */
export function roleHome(user: Pick<User, 'role' | 'tenant_id'>): string {
  switch (user.role) {
    case 'CITIZEN':
      return '/c';
    case 'HELPER':
      return '/h';
    case 'OFFICER':
      return '/staff/queue';
    case 'ADMIN':
      return user.tenant_id === null ? '/admin/mocks' : '/admin/rules';
    case 'AUDITOR':
      return '/auditor/events';
    default:
      return '/c';
  }
}

export function isStaffRole(role: Role | null): boolean {
  return role === 'OFFICER' || role === 'ADMIN' || role === 'AUDITOR';
}
