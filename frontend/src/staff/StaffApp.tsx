import { cloneElement, isValidElement, Suspense, lazy, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { roleHome } from '../shared/auth/roleHome';
import type { Session } from '../shared/auth/session';
import { useDemoMode } from '../shared/auth/useDemoMode';
import { BrandLockup } from '../shared/ui/Brand';
import { LanguageSelector } from '../shared/ui/LanguageSelector';
import { useI18n } from '../shared/i18n/I18nProvider';
import type { Role } from '../shared/api/types';
import { staffText } from './staffI18n';
import {
  IconChart,
  IconGavel,
  IconKey,
  IconList,
  IconLogout,
  IconMenu,
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
  detail?: string;
  platformOnly?: boolean;
  tenantOnly?: boolean;
  demoOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'Cases',
    items: [
      { to: '/staff/queue', detail: '/staff/cases/:id', label: 'Cases to review', Icon: IconList, roles: ['OFFICER'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/staff/eval', label: 'Evaluation', Icon: IconChart, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
      { to: '/staff/analytics', label: 'Analytics', Icon: IconChart, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/rules', detail: '/admin/rules/:id/twin', label: 'Rules & Digital Twin', Icon: IconGavel, roles: ['ADMIN'], tenantOnly: true },
      { to: '/admin/users', label: 'Users', Icon: IconUsers, roles: ['ADMIN'] },
      { to: '/admin/api-keys', label: 'API keys', Icon: IconKey, roles: ['ADMIN'], tenantOnly: true },
      { to: '/admin/jobs', label: 'Jobs & Health', Icon: IconServer, roles: ['ADMIN'] },
    ],
  },
  {
    title: 'Audit',
    items: [
      { to: '/auditor/events', detail: '/auditor/cases/:id', label: 'Audit events', Icon: IconShield, roles: ['AUDITOR'] },
      { to: '/auditor/consents', label: 'Consent audit', Icon: IconUsers, roles: ['AUDITOR'] },
      { to: '/admin/rules', label: 'Rule history', Icon: IconGavel, roles: ['AUDITOR'], tenantOnly: true },
    ],
  },
  {
    title: 'Demo',
    items: [
      { to: '/staff/device-sim', label: 'Device simulator', Icon: IconPhone, roles: ['OFFICER', 'ADMIN', 'AUDITOR'], demoOnly: true },
      { to: '/admin/mocks', label: 'Mock services', Icon: IconServer, roles: ['ADMIN'], platformOnly: true },
    ],
  },
];

const STAFF_LABELS: Record<string, [string, string]> = {
  Cases: ['کیسز', 'ڪيس'], Reports: ['رپورٹس', 'رپورٽون'], Administration: ['انتظامیہ', 'انتظام'], Audit: ['آڈٹ', 'آڊٽ'], Demo: ['ڈیمو', 'ڊيمو'],
  'Cases to review': ['جائزے کے لیے کیسز', 'جائزي لاءِ ڪيس'], Evaluation: ['جائزہ', 'جائزو'], Analytics: ['تجزیات', 'تجزيا'],
  'Rules & Digital Twin': ['قواعد اور ڈیجیٹل ٹوئن', 'قاعدا ۽ ڊجيٽل ٽوئن'], Users: ['صارفین', 'استعمال ڪندڙ'], 'API keys': ['API کیز', 'API ڪيز'],
  'Jobs & Health': ['کام اور نظام کی حالت', 'ڪم ۽ نظام جي حالت'], 'Audit events': ['آڈٹ واقعات', 'آڊٽ واقعا'], 'Consent audit': ['رضامندی کا آڈٹ', 'رضامندي آڊٽ'],
  'Rule history': ['قواعد کی تاریخ', 'قاعدن جي تاريخ'], 'Device simulator': ['ڈیوائس سمیولیٹر', 'ڊوائيس سميوليٽر'], 'Mock services': ['نقلی سروسز', 'نقلي خدمتون'],
  Menu: ['مینو', 'مينيو'], 'Real vs Simulated': ['حقیقی اور نقلی', 'حقيقي ۽ نقلي'], 'Sign out': ['لاگ آؤٹ', 'لاگ آئوٽ'],
};

function staffLabel(label: string, lang: 'ur' | 'sd' | 'en') {
  return lang === 'en' ? label : STAFF_LABELS[label]?.[lang === 'ur' ? 0 : 1] ?? label;
}

function PageFallback() {
  return (
    <div className="py-10" role="status" aria-label={staffText("Loading console")}>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-9 rounded-control bg-raised" />
        ))}
      </div>
    </div>
  );
}

function StaffNavigation({ groups, current, onNavigate }: {
  groups: NavGroup[];
  current: NavItem;
  onNavigate?: () => void;
}) {
  const { lang } = useI18n();
  return (
    <nav aria-label={staffText("Workspace")} className="space-y-5 px-3 py-4">
      {groups.map(({ title, items }) => (
        <div key={title}>
          <p className="mb-1 px-3 text-meta font-medium text-ink-3">{staffLabel(title, lang)}</p>
          <ul className="space-y-1">
            {items.map(({ to, label, Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  onClick={onNavigate}
                  aria-current={to === current.to ? 'page' : undefined}
                  className={`press flex min-h-tap items-center gap-2.5 rounded-control border-s-2 px-3 text-caption md:min-h-[40px] ${
                    to === current.to
                      ? 'border-accent bg-accent-wash font-semibold text-accent-ink'
                      : 'border-transparent text-ink-2 hover:bg-raised hover:text-ink'
                  }`}
                >
                  <Icon size={17} className="shrink-0" />
                  <span>{staffLabel(label, lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function StaffApp({ children, session, groups, current }: {
  children: ReactNode;
  session: Session;
  groups: NavGroup[];
  current: NavItem;
}) {
  const { lang, dir } = useI18n();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const role = session.user.role;
  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }

  return (
    <div
      className="flex min-h-[calc(100dvh-var(--banner-h))] bg-paper text-ink"
      dir={dir}
      lang={lang}
    >
      <aside className="sticky top-[var(--banner-h)] hidden max-h-[calc(100dvh-var(--banner-h))] w-[232px] shrink-0 self-start overflow-y-auto border-e border-ink/[0.08] bg-card md:block">
        <div className="border-b border-ink/[0.08] px-5 py-4">
          <BrandLockup height={22} />
          <p className="mt-1.5 text-meta text-ink-3">{lang === 'en' ? `${roleWord(role)} workspace` : `${role === 'OFFICER' ? (lang === 'ur' ? 'افسر' : 'آفيسر') : role === 'ADMIN' ? (lang === 'ur' ? 'منتظم' : 'منتظم') : (lang === 'ur' ? 'آڈیٹر' : 'آڊيٽر')} ${lang === 'ur' ? 'ورک اسپیس' : 'ڪم جي جاءِ'}`}</p>
        </div>

        <StaffNavigation groups={groups} current={current} />

        <div className="border-t border-ink/[0.08] px-5 py-3">
          <p className="truncate text-caption text-ink">{session.user.full_name}</p>
          <p className="mt-0.5 text-meta text-ink-3">
            {roleWord(role)} {staffText(" · ")}{session.tenant?.code ?? 'Platform scope'}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[var(--banner-h)] z-30 border-b border-ink/[0.08] bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-1.5 md:px-6 lg:px-8">
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="staff-mobile-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
              className="press flex min-h-tap shrink-0 items-center gap-2 rounded-control px-2 text-caption font-medium text-ink-2 hover:bg-raised md:hidden"
            >
              <IconMenu size={18} />
              {staffText("\r\n              Menu\r\n            ")}</button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption font-semibold text-ink">{staffLabel(current.label, lang)}</p>
              <p className="truncate text-meta text-ink-3">{session.tenant?.name ?? 'Platform scope'}</p>
            </div>
            <Link
              to="/transparency"
              className="press hidden rounded-control px-2 py-1.5 text-meta text-ink-2 hover:bg-raised hover:text-ink sm:inline-block"
            >
              {staffLabel('Real vs Simulated', lang)}
            </Link>
            <LanguageSelector className="min-h-[40px]" />
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }));
              }}
              className="press flex min-h-tap shrink-0 items-center gap-2 rounded-control px-2 text-meta text-ink-2 hover:bg-raised hover:text-ink"
            >
              <IconLogout size={16} />
              {staffLabel('Sign out', lang)}
            </button>
          </div>
          <div
            id="staff-mobile-navigation"
            className="max-h-[50dvh] overflow-y-auto border-t border-ink/[0.08] md:hidden"
            hidden={!menuOpen}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeMenu();
            }}
          >
            {menuOpen && <StaffNavigation groups={groups} current={current} onNavigate={closeMenu} />}
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="console-page">
            <Suspense fallback={<PageFallback />}>
              {isValidElement(children)
                ? cloneElement(children as React.ReactElement<{ staffLocale?: string }>, { staffLocale: lang })
                : children}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Route table for /staff/*, /admin/*, /auditor/* - mounted lazily from App.
 *
 * Deliberately a `matchPath` switch rather than a nested `<Routes>`: the same
 * component is mounted under three different prefixes, and absolute paths in a
 * descendant `<Routes>` do not resolve against the outer router's location.
 */
export function StaffRoutes() {
  const { pathname } = useLocation();
  const { session } = useAuth();
  const demoMode = useDemoMode();

  const page = (() => {
    if (matchPath('/staff/queue', pathname)) return <QueuePage />;
    const review = matchPath('/staff/cases/:id', pathname);
    if (review) return <CaseReviewPage key={review.params.id} caseId={review.params.id} />;
    if (matchPath('/staff/eval', pathname)) return <EvalPage />;
    if (matchPath('/staff/analytics', pathname)) return <AnalyticsPage />;
    if (matchPath('/staff/device-sim', pathname)) return <DeviceSimPage />;
    if (matchPath('/admin/rules', pathname)) return <RulesPage canEdit={session?.user.role === 'ADMIN'} />;
    if (matchPath('/admin/rules/:id/twin', pathname)) return <RulesPage canEdit />;
    if (matchPath('/admin/users', pathname)) return <UsersPage />;
    if (matchPath('/admin/api-keys', pathname)) return <ApiKeysPage />;
    if (matchPath('/admin/mocks', pathname)) return <MocksPage />;
    if (matchPath('/admin/jobs', pathname)) return <JobsPage />;
    if (matchPath('/auditor/events', pathname)) return <EventsPage />;
    const trace = matchPath('/auditor/cases/:id', pathname);
    if (trace) return <TracePage caseId={trace.params.id} />;
    if (matchPath('/auditor/consents', pathname)) return <ConsentsPage />;
    return null;
  })();

  if (!session) return null;
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.roles.includes(session.user.role)
      && (!item.platformOnly || session.user.tenant_id === null)
      && (!item.tenantOnly || session.user.tenant_id !== null)
      && (!item.demoOnly || demoMode.data === true)),
  })).filter((group) => group.items.length > 0);
  const current = groups.flatMap((group) => group.items).find(({ to, detail }) =>
    matchPath(to, pathname) || (detail && matchPath(detail, pathname)));

  if (!current || !page) {
    if (matchPath('/staff/device-sim', pathname) && demoMode.isPending) return <PageFallback />;
    return <Navigate to={roleHome(session.user)} replace />;
  }
  return <StaffApp key={pathname} session={session} groups={groups} current={current}>{page}</StaffApp>;
}
