import type { Role } from '../api/types';

/** Where each role lands after sign-in (AC-01.1). */
export function roleHome(role: Role): string {
  switch (role) {
    case 'CITIZEN':
      return '/c';
    case 'HELPER':
      return '/h';
    case 'OFFICER':
      return '/staff/queue';
    case 'ADMIN':
      return '/admin/rules';
    case 'AUDITOR':
      return '/auditor/events';
    default:
      return '/c';
  }
}

export function isStaffRole(role: Role | null): boolean {
  return role === 'OFFICER' || role === 'ADMIN' || role === 'AUDITOR';
}
