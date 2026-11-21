import { Suspense, lazy, useMemo } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Navigate, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { BrandLockup } from '../shared/ui/Brand';
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
import { roleWord } from './ui';

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
      { to: '/staff/queue', label: 'Review queue', Icon: IconList, roles: ['OFFICER'] },
      { to: '/staff/eval', label: 'Evaluation', Icon: IconChart, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
      { to: '/staff/analytics', label: 'Analytics', Icon: IconChart, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/admin/rules', label: 'Rules & Digital Twin', Icon: IconGavel, roles: ['ADMIN'] },
      { to: '/admin/users', label: 'Users', Icon: IconUsers, roles: ['ADMIN'] },
      { to: '/admin/api-keys', label: 'API keys', Icon: IconKey, roles: ['ADMIN'] },
      { to: '/admin/mocks', label: 'Mock services', Icon: IconServer, roles: ['ADMIN'] },
      { to: '/admin/jobs', label: 'Jobs & Health', Icon: IconServer, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Auditor',
    items: [
      { to: '/auditor/events', label: 'Audit events', Icon: IconShield, roles: ['AUDITOR'] },
      { to: '/auditor/consents', label: 'Consent audit', Icon: IconUsers, roles: ['AUDITOR'] },
    ],
  },
  {
    title: 'Demo',
    items: [
      { to: '/staff/device-sim', label: 'Device simulator', Icon: IconPhone, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
    ],
  },
];

function PageFallback() {
  return (
    <div className="py-10" role="status" aria-label="Loading console">
      <div className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-9 rounded-control bg-raised" />
        ))}
      </div>
    </div>
  );
}

/**
 * Staff shell — docs/11 §6. Lazy-loaded as its own chunk so none of this code
 * can ever reach the citizen entry bundle.
 *
 * The console is a tool, not a page: a fixed 248px rail, 34px nav rows, and a
 * content column capped at 1440 so a 27-inch monitor does not stretch a table
 * into unreadable lines. The rail is the only place with a filled surface, which
 * is what keeps the eye on the work.
 */
export default function StaffApp({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const role = session?.user.role ?? 'OFFICER';

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);

  return (
    <div
      className="flex min-h-[calc(100dvh-var(--banner-h))] bg-paper text-ink"
      dir="ltr"
      lang="en"
    >
      <aside className="hidden w-[248px] shrink-0 border-e border-ink/[0.08] bg-card md:flex md:flex-col">
        <div className="border-b border-ink/[0.08] px-5 py-4">
          <BrandLockup height={22} />
          <p className="mt-1.5 text-meta text-ink-3">Staff console</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.title} className="mb-6 last:mb-0">
              <p className="mb-2 px-2 text-meta text-ink-3">{group.title}</p>
              <ul>
                {group.items.map(({ to, label, Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className={({ isActive }) =>
                        `press flex min-h-[34px] items-center gap-2.5 rounded-[8px] px-2 text-caption ${
                          isActive
                            ? 'row-active font-medium text-accent-ink'
                            : 'text-ink-2 hover:bg-raised hover:text-ink'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon size={16} className={isActive ? 'text-accent' : 'text-ink-3'} />
                          <span className="truncate">{label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink/[0.08] px-5 py-3">
          <p className="truncate text-caption text-ink">{session?.user.full_name}</p>
          <p className="mt-0.5 text-meta text-ink-3">
            {roleWord(role)} · {session?.tenant?.code ?? 'Platform scope'}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink/[0.08] bg-card/95 px-6 py-2.5 backdrop-blur-sm lg:px-8">
          <span className="rounded-[6px] border border-ink/[0.12] px-1.5 py-0.5 font-mono text-meta text-ink-2">
            {session?.tenant?.code ?? 'PLATFORM'}
          </span>
          <span className="hidden truncate text-meta text-ink-3 sm:block">
            {session?.tenant?.name ?? 'Platform scope'}
          </span>

          <div className="ms-auto flex items-center gap-1">
            <NavLink
              to="/transparency"
              className="press rounded-[8px] px-2 py-1.5 text-meta text-ink-2 hover:bg-raised hover:text-ink"
            >
              Real vs Simulated
            </NavLink>
            <NavLink
              to="/scam-check"
              className="press hidden rounded-[8px] px-2 py-1.5 text-meta text-ink-2 hover:bg-raised hover:text-ink sm:inline-block"
            >
              Scam Checker
            </NavLink>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }));
              }}
              className="press grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-raised hover:text-ink"
              aria-label="Sign out"
            >
              <IconLogout size={16} />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="console-page">
            <Suspense fallback={<PageFallback />}>{children}</Suspense>
          </div>
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
