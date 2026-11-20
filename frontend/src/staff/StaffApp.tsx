import { Suspense, lazy, useMemo } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Navigate, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import type { Role } from '../shared/api/types';
import {
  IconChart,
  IconGavel,
  IconKey,
  IconList,
  IconLogout,
  IconPhone,
  IconServer,
  IconShield,
  IconUsers,
} from '../shared/ui/Icons';

const QueuePage = lazy(() => import('./pages/QueuePage'));
const CaseReviewPage = lazy(() => import('./pages/CaseReviewPage'));
const EvalPage = lazy(() => import('./pages/EvalPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const DeviceSimPage = lazy(() => import('./pages/DeviceSimPage'));
const RulesPage = lazy(() => import('./admin/RulesPage'));
const UsersPage = lazy(() => import('./admin/UsersPage'));
const ApiKeysPage = lazy(() => import('./admin/ApiKeysPage'));
const MocksPage = lazy(() => import('./admin/MocksPage'));
const JobsPage = lazy(() => import('./admin/JobsPage'));
const EventsPage = lazy(() => import('./auditor/EventsPage'));
const TracePage = lazy(() => import('./auditor/TracePage'));
const ConsentsPage = lazy(() => import('./auditor/ConsentsPage'));

interface NavItem {
  to: string;
  label: string;
  Icon: typeof IconList;
  roles: Role[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'Officer',
    items: [
      { to: '/staff/queue', label: 'Review queue', Icon: IconList, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
      { to: '/staff/eval', label: 'Evaluation', Icon: IconChart, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
      { to: '/staff/analytics', label: 'Analytics', Icon: IconChart, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/admin/rules', label: 'Rules & Digital Twin', Icon: IconGavel, roles: ['ADMIN', 'AUDITOR'] },
      { to: '/admin/users', label: 'Users', Icon: IconUsers, roles: ['ADMIN'] },
      { to: '/admin/api-keys', label: 'API keys', Icon: IconKey, roles: ['ADMIN'] },
      { to: '/admin/mocks', label: 'Mock services', Icon: IconServer, roles: ['ADMIN'] },
      { to: '/admin/jobs', label: 'Jobs', Icon: IconServer, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Auditor',
    items: [
      { to: '/auditor/events', label: 'Audit events', Icon: IconShield, roles: ['AUDITOR', 'ADMIN'] },
      { to: '/auditor/consents', label: 'Consent audit', Icon: IconUsers, roles: ['AUDITOR', 'ADMIN'] },
    ],
  },
  {
    title: 'Demo',
    items: [{ to: '/staff/device-sim', label: 'Device simulator', Icon: IconPhone, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] }],
  },
];

function PageFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-ink-soft">Loading console…</div>
  );
}

/**
 * Staff shell — docs/11 §6. Lazy-loaded as its own chunk so none of this code
 * can ever reach the citizen entry bundle.
 */
export default function StaffApp({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const role = session?.user.role ?? 'OFFICER';

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-[calc(100dvh-28px)] bg-[#F7F7F5] text-ink" dir="ltr">
      <aside className="hidden w-60 shrink-0 border-e border-ink/10 bg-white md:block">
        <div className="border-b border-ink/10 px-4 py-3">
          <p className="text-sm font-bold text-teal-700">Haqdaar</p>
          <p className="text-[11px] uppercase tracking-wide text-ink-soft">Staff console</p>
        </div>
        <nav className="p-2">
          {groups.map((group) => (
            <div key={group.title} className="mb-3">
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft">{group.title}</p>
              <ul>
                {group.items.map(({ to, label, Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className={({ isActive }) =>
                        `flex min-h-tap items-center gap-2 rounded-lg px-2 text-sm font-medium ${
                          isActive ? 'bg-teal-50 text-teal-800' : 'text-ink-soft hover:bg-ink/5'
                        }`
                      }
                    >
                      <Icon size={16} />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ink/10 bg-white px-4 py-2">
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-800">
            {session?.tenant?.code ?? 'PLATFORM'}
          </span>
          <span className="text-xs text-ink-soft">{session?.tenant?.name ?? 'Platform scope'}</span>
          <div className="ms-auto flex items-center gap-2">
            <span className="text-xs font-semibold text-ink">{session?.user.full_name}</span>
            <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-soft">{role}</span>
            <NavLink to="/c" className="rounded px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50">
              {t('app.name')} app
            </NavLink>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }));
              }}
              className="grid h-tap w-tap place-items-center rounded-full text-ink-soft hover:bg-ink/5"
              aria-label="Sign out"
            >
              <IconLogout size={16} />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-auto p-4">
          <Suspense fallback={<PageFallback />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

/**
 * Route table for /staff/*, /admin/*, /auditor/* — mounted lazily from App.
 *
 * Deliberately a `matchPath` switch rather than a nested `<Routes>`: the same
 * component is mounted under three different prefixes, and absolute paths in a
 * descendant `<Routes>` do not resolve against the outer router's location.
 */
export function StaffRoutes() {
  const { pathname } = useLocation();

  const page = useMemo<ReactNode>(() => {
    if (matchPath('/staff/queue', pathname)) return <QueuePage />;
    const review = matchPath('/staff/cases/:id', pathname);
    if (review) return <CaseReviewPage caseId={review.params.id} />;
    if (matchPath('/staff/eval', pathname)) return <EvalPage />;
    if (matchPath('/staff/analytics', pathname)) return <AnalyticsPage />;
    if (matchPath('/staff/device-sim', pathname)) return <DeviceSimPage />;
    if (matchPath('/admin/rules', pathname)) return <RulesPage />;
    if (matchPath('/admin/rules/:id/twin', pathname)) return <RulesPage />;
    if (matchPath('/admin/users', pathname)) return <UsersPage />;
    if (matchPath('/admin/api-keys', pathname)) return <ApiKeysPage />;
    if (matchPath('/admin/mocks', pathname)) return <MocksPage />;
    if (matchPath('/admin/jobs', pathname)) return <JobsPage />;
    if (matchPath('/auditor/events', pathname)) return <EventsPage />;
    const trace = matchPath('/auditor/cases/:id', pathname);
    if (trace) return <TracePage caseId={trace.params.id} />;
    if (matchPath('/auditor/consents', pathname)) return <ConsentsPage />;
    return <Navigate to="/staff/queue" replace />;
  }, [pathname]);

  return <StaffApp>{page}</StaffApp>;
}
