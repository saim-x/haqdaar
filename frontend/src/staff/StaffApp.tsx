import {
  Activity,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  Search,
  ArrowUpRight,
  Moon,
  ScrollText,
  Server,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Role } from '../shared/api/types';
import { logout } from '../shared/auth/session';
import { homePathFor, useAuth } from '../shared/auth/store';
import { cx } from '../shared/ui/cx';
import { HaqdaarMark } from '../shared/ui/AjrakPattern';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Modal } from '../shared/ui/Modal';
import { Queue } from './officer/Queue';
import { CaseReview } from './officer/CaseReview';
import { Corrections } from './officer/Corrections';
import { RuleEditor } from './admin/RuleEditor';
import { UsersPage } from './admin/UsersPage';
import { ApiKeysPage } from './admin/ApiKeysPage';
import { MocksPage } from './admin/MocksPage';
import { JobsPage } from './admin/JobsPage';
import { AuditEvents } from './auditor/AuditEvents';
import { TraceInspector } from './auditor/TraceInspector';
import { ConsentAudit } from './auditor/ConsentAudit';
import { EvalDashboardPage } from './insights/EvalDashboardPage';
import { AnalyticsPage } from './insights/AnalyticsPage';
import { DeviceSim } from './insights/DeviceSim';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  platformOnly?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Casework',
    items: [
      { to: '/staff/queue', label: 'Review queue', icon: ClipboardList, roles: ['OFFICER'] },
      { to: '/staff/corrections', label: 'Data corrections', icon: ClipboardCheck, roles: ['OFFICER'] },
    ],
  },
  {
    group: 'Policy',
    items: [
      { to: '/admin/rules', label: 'Rules & Digital Twin', icon: Workflow, roles: ['ADMIN', 'AUDITOR'] },
    ],
  },
  {
    group: 'Oversight',
    items: [
      { to: '/auditor/events', label: 'Audit log', icon: ScrollText, roles: ['AUDITOR'] },
      { to: '/auditor/cases', label: 'Decision traces', icon: FileSearch, roles: ['AUDITOR'] },
      { to: '/auditor/consents', label: 'Consent records', icon: ShieldCheck, roles: ['AUDITOR'] },
    ],
  },
  {
    group: 'Insight',
    items: [
      { to: '/staff/eval', label: 'Evaluation', icon: Gauge, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
      {
        to: '/staff/analytics',
        label: 'Tenant analytics',
        icon: BarChart3,
        roles: ['OFFICER', 'ADMIN', 'AUDITOR'],
      },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users', icon: Users, roles: ['ADMIN'] },
      { to: '/admin/api-keys', label: 'API keys', icon: KeyRound, roles: ['ADMIN'] },
      { to: '/admin/mocks', label: 'Simulated services', icon: Server, roles: ['ADMIN'], platformOnly: true },
      { to: '/admin/jobs', label: 'Background jobs', icon: Activity, roles: ['ADMIN'] },
    ],
  },
  {
    group: 'Demo',
    items: [
      {
        to: '/staff/device-sim',
        label: 'Device simulator',
        icon: Smartphone,
        roles: ['OFFICER', 'ADMIN', 'AUDITOR'],
      },
    ],
  },
];

function Guard({
  roles,
  children,
  platformOnly,
}: {
  roles: Role[];
  children: ReactNode;
  platformOnly?: boolean;
}) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role) || (platformOnly && user.tenant_id))
    return <Navigate to={homePathFor(user?.role)} replace />;
  return <>{children}</>;
}

const THEME_KEY = 'hq.staff.theme';

export default function StaffApp() {
  const { user, tenant } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    return () => {
      document.documentElement.dataset.theme = 'light';
    };
  }, [dark]);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  if (!user) return null;
  const items = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(user.role) && (!i.platformOnly || !user.tenant_id)),
  })).filter((g) => g.items.length);
  const current = items.flatMap((group) => group.items).find((item) => loc.pathname.startsWith(item.to));
  const searchItems = items
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.group })))
    .filter((item) => `${item.group} ${item.label}`.toLowerCase().includes(search.toLowerCase().trim()));

  const sidebar = (
    <nav aria-label="Staff" className="flex h-full flex-col gap-6 overflow-y-auto p-5">
      <div className="flex min-h-12 items-center gap-3">
        <HaqdaarMark className="h-9 w-9 rounded-xl" />
        <div>
          <p className="text-lg font-bold leading-tight tracking-tight">
            Haqdaar<span className="text-primary">.</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Service workspace
          </p>
        </div>
      </div>
      {items.map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {g.group}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-fast',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <i.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <div className="px-2">
          <p className="truncate text-sm font-semibold">{user.full_name}</p>
          <p className="text-xs text-muted-foreground">
            {user.role}
            {tenant ? ` · ${tenant.code}` : user.tenant_id ? '' : ' · Platform'}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted"
            aria-pressed={dark}
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            {dark ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            onClick={() => {
              void logout();
              nav('/login');
            }}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Log out
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-[calc(100dvh-28px)]" lang="en" dir="ltr">
      <Toaster position="top-right" />
      <aside className="sticky top-[28px] hidden h-[calc(100dvh-28px)] w-[264px] shrink-0 border-e border-border bg-card lg:block">
        {sidebar}
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetTitle className="sr-only">Staff navigation</SheetTitle>
          <SheetDescription className="sr-only">Navigate your service workspace</SheetDescription>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1">
        <div className="sticky top-[28px] z-30 flex min-h-[76px] items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="inline-flex h-12 w-12 items-center justify-center rounded-lg hover:bg-muted lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground sm:block">
              {user.role === 'OFFICER'
                ? 'Casework'
                : user.role === 'AUDITOR'
                  ? 'Oversight'
                  : 'Administration'}
            </p>
            <p className="truncate text-sm font-semibold">{current?.label ?? 'Case workspace'}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSearchOpen(true);
            }}
            className="ms-auto inline-flex min-h-12 items-center gap-3 rounded-xl border border-border bg-background px-3 text-sm text-muted-foreground hover:border-primary/40"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Go to a page</span>
            <span className="sr-only sm:hidden">Go to a page</span>
            <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 text-[10px] md:inline">
              Ctrl K
            </kbd>
          </button>
          <span className="hidden rounded-full border border-border px-3 py-1.5 text-xs font-semibold sm:block">
            {tenant?.code ?? 'Platform'}
          </span>
        </div>
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-7 lg:px-8 lg:py-9">
          <Routes>
            <Route
              path="/staff/queue"
              element={
                <Guard roles={['OFFICER']}>
                  <Queue />
                </Guard>
              }
            />
            <Route
              path="/staff/cases/:id"
              element={
                <Guard roles={['OFFICER']}>
                  <CaseReview />
                </Guard>
              }
            />
            <Route
              path="/staff/corrections"
              element={
                <Guard roles={['OFFICER']}>
                  <Corrections />
                </Guard>
              }
            />
            <Route
              path="/staff/eval"
              element={
                <Guard roles={['OFFICER', 'ADMIN', 'AUDITOR']}>
                  <EvalDashboardPage />
                </Guard>
              }
            />
            <Route
              path="/staff/analytics"
              element={
                <Guard roles={['OFFICER', 'ADMIN', 'AUDITOR']}>
                  <AnalyticsPage />
                </Guard>
              }
            />
            <Route
              path="/staff/device-sim"
              element={
                <Guard roles={['OFFICER', 'ADMIN', 'AUDITOR']}>
                  <DeviceSim />
                </Guard>
              }
            />
            <Route
              path="/admin/rules"
              element={
                <Guard roles={['ADMIN', 'AUDITOR']}>
                  <RuleEditor />
                </Guard>
              }
            />
            <Route
              path="/admin/users"
              element={
                <Guard roles={['ADMIN']}>
                  <UsersPage />
                </Guard>
              }
            />
            <Route
              path="/admin/api-keys"
              element={
                <Guard roles={['ADMIN']}>
                  <ApiKeysPage />
                </Guard>
              }
            />
            <Route
              path="/admin/mocks"
              element={
                <Guard roles={['ADMIN']} platformOnly>
                  <MocksPage />
                </Guard>
              }
            />
            <Route
              path="/admin/jobs"
              element={
                <Guard roles={['ADMIN']}>
                  <JobsPage />
                </Guard>
              }
            />
            <Route
              path="/auditor/events"
              element={
                <Guard roles={['AUDITOR']}>
                  <AuditEvents />
                </Guard>
              }
            />
            <Route
              path="/auditor/cases"
              element={
                <Guard roles={['AUDITOR']}>
                  <TraceInspector />
                </Guard>
              }
            />
            <Route
              path="/auditor/cases/:id"
              element={
                <Guard roles={['AUDITOR']}>
                  <TraceInspector />
                </Guard>
              }
            />
            <Route
              path="/auditor/consents"
              element={
                <Guard roles={['AUDITOR']}>
                  <ConsentAudit />
                </Guard>
              }
            />
            <Route path="*" element={<Navigate to={homePathFor(user.role)} replace />} />
          </Routes>
        </main>
        <Modal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          title="Go to a page"
          description="Find a page in your workspace. Use Ctrl K to open this menu."
        >
          <label className="relative block">
            <span className="sr-only">Find a page</span>
            <Search className="absolute left-3 top-4 h-5 w-5 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchItems[0]) {
                  nav(searchItems[0].to);
                  setSearchOpen(false);
                }
              }}
              placeholder="Search pages…"
              className="min-h-14 w-full rounded-xl border border-input bg-background pl-11 pr-4"
            />
          </label>
          <div className="mt-3 space-y-1">
            {searchItems.map((item) => (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  nav(item.to);
                  setSearchOpen(false);
                }}
                className="group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-start hover:bg-primary-soft"
              >
                <item.icon className="h-5 w-5 text-primary" aria-hidden />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.group}</span>
                </span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground group-hover:text-primary"
                  aria-hidden
                />
              </button>
            ))}
            {!searchItems.length && (
              <p role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
                No pages match “{search}”. Try another name.
              </p>
            )}
          </div>
        </Modal>
      </div>
    </div>
  );
}
