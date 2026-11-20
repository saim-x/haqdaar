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
    items: [{ to: '/admin/rules', label: 'Rules & Digital Twin', icon: Workflow, roles: ['ADMIN', 'AUDITOR'] }],
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
      { to: '/staff/analytics', label: 'Tenant analytics', icon: BarChart3, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] },
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
    items: [{ to: '/staff/device-sim', label: 'Device simulator', icon: Smartphone, roles: ['OFFICER', 'ADMIN', 'AUDITOR'] }],
  },
];

function Guard({ roles, children, platformOnly }: { roles: Role[]; children: ReactNode; platformOnly?: boolean }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role) || (platformOnly && user.tenant_id)) return <Navigate to={homePathFor(user?.role)} replace />;
  return <>{children}</>;
}

const THEME_KEY = 'hq.staff.theme';

export default function StaffApp() {
  const { user, tenant } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    return () => {
      document.documentElement.dataset.theme = 'light';
    };
  }, [dark]);
  useEffect(() => setOpen(false), [loc.pathname]);

  if (!user) return null;
  const items = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role) && (!i.platformOnly || !user.tenant_id)) })).filter((g) => g.items.length);

  const sidebar = (
    <nav aria-label="Staff" className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <HaqdaarMark className="h-9 w-9 rounded-xl" />
        <div>
          <p className="font-bold leading-tight">Haqdaar</p>
          <p className="text-xs text-muted-foreground">Staff console · prototype</p>
        </div>
      </div>
      {items.map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-[40px] items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors duration-fast',
                      isActive ? 'bg-primary-soft font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
      <aside className="sticky top-[28px] hidden h-[calc(100dvh-28px)] w-64 shrink-0 border-e border-border bg-card lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-card shadow-lift">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="sticky top-[28px] z-30 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted">
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="font-semibold">Haqdaar staff</span>
          {tenant && <span className="ms-auto rounded-md bg-muted px-2 py-0.5 text-xs font-bold">{tenant.code}</span>}
        </div>
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
          <Routes>
            <Route path="/staff/queue" element={<Guard roles={['OFFICER']}><Queue /></Guard>} />
            <Route path="/staff/cases/:id" element={<Guard roles={['OFFICER']}><CaseReview /></Guard>} />
            <Route path="/staff/corrections" element={<Guard roles={['OFFICER']}><Corrections /></Guard>} />
            <Route path="/staff/eval" element={<Guard roles={['OFFICER', 'ADMIN', 'AUDITOR']}><EvalDashboardPage /></Guard>} />
            <Route path="/staff/analytics" element={<Guard roles={['OFFICER', 'ADMIN', 'AUDITOR']}><AnalyticsPage /></Guard>} />
            <Route path="/staff/device-sim" element={<Guard roles={['OFFICER', 'ADMIN', 'AUDITOR']}><DeviceSim /></Guard>} />
            <Route path="/admin/rules" element={<Guard roles={['ADMIN', 'AUDITOR']}><RuleEditor /></Guard>} />
            <Route path="/admin/users" element={<Guard roles={['ADMIN']}><UsersPage /></Guard>} />
            <Route path="/admin/api-keys" element={<Guard roles={['ADMIN']}><ApiKeysPage /></Guard>} />
            <Route path="/admin/mocks" element={<Guard roles={['ADMIN']} platformOnly><MocksPage /></Guard>} />
            <Route path="/admin/jobs" element={<Guard roles={['ADMIN']}><JobsPage /></Guard>} />
            <Route path="/auditor/events" element={<Guard roles={['AUDITOR']}><AuditEvents /></Guard>} />
            <Route path="/auditor/cases" element={<Guard roles={['AUDITOR']}><TraceInspector /></Guard>} />
            <Route path="/auditor/cases/:id" element={<Guard roles={['AUDITOR']}><TraceInspector /></Guard>} />
            <Route path="/auditor/consents" element={<Guard roles={['AUDITOR']}><ConsentAudit /></Guard>} />
            <Route path="*" element={<Navigate to={homePathFor(user.role)} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
