import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from './shared/api/types';
import { homePathFor, useAuth } from './shared/auth/store';
import { applyDocumentLang, useLang } from './shared/i18n';
import { PageLoader } from './shared/ui/Spinner';
import { PrototypeBanner } from './shared/ui/PrototypeBanner';
import { Toaster } from '@/components/ui/sonner';
import { CitizenShell } from './citizen/CitizenShell';
import { LoginPage } from './pages/LoginPage';
import { CitizenHome } from './citizen/CitizenHome';

// Route-level code splitting keeps the citizen entry bundle small on 2G/3G
// (AC-24.3). Every chunk is still precached by the service worker for offline use.
const ApplyStart = lazy(() => import('./citizen/ApplyStart').then((m) => ({ default: m.ApplyStart })));
const Wizard = lazy(() => import('./citizen/wizard/Wizard').then((m) => ({ default: m.Wizard })));
const CasesList = lazy(() => import('./citizen/CasesList').then((m) => ({ default: m.CasesList })));
const CaseStatusPage = lazy(() => import('./citizen/CaseStatusPage').then((m) => ({ default: m.CaseStatusPage })));
const ConsentCenter = lazy(() => import('./citizen/ConsentCenter').then((m) => ({ default: m.ConsentCenter })));
const MyData = lazy(() => import('./citizen/MyData').then((m) => ({ default: m.MyData })));
const ScamCheck = lazy(() => import('./citizen/ScamCheck').then((m) => ({ default: m.ScamCheck })));
const AskPage = lazy(() => import('./citizen/AskPage').then((m) => ({ default: m.AskPage })));
const FamilyRoster = lazy(() => import('./helper/FamilyRoster').then((m) => ({ default: m.FamilyRoster })));
const AddFamily = lazy(() => import('./helper/AddFamily').then((m) => ({ default: m.AddFamily })));
const SwitchInterstitial = lazy(() => import('./helper/SwitchInterstitial').then((m) => ({ default: m.SwitchInterstitial })));
const TransparencyPage = lazy(() => import('./pages/TransparencyPage').then((m) => ({ default: m.TransparencyPage })));

// Staff consoles are a separate lazily-loaded chunk so they never inflate the
// citizen PWA bundle (docs/11 §1).
const StaffApp = lazy(() => import('./staff/StaffApp'));

const STAFF_PREFIXES = ['/staff', '/admin', '/auditor'];

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, accessToken } = useAuth();
  const loc = useLocation();
  if (!accessToken || !user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <>{children}</>;
}

/** Citizen screens: a citizen, or a helper who has picked a family to act for. */
function RequireCitizenContext({ children }: { children: ReactNode }) {
  const { user, actingFor } = useAuth();
  if (user?.role === 'HELPER' && !actingFor) return <Navigate to="/h" replace />;
  return <>{children}</>;
}

export function App() {
  const lang = useLang();
  const loc = useLocation();
  const { user } = useAuth();
  const isStaff = STAFF_PREFIXES.some((p) => loc.pathname.startsWith(p));

  useEffect(() => {
    // Staff consoles are English/LTR; citizen surfaces follow the chosen language.
    applyDocumentLang(isStaff ? 'en' : lang);
  }, [lang, isStaff]);

  if (isStaff) {
    return (
      <>
        <PrototypeBanner forceEnglish />
        <Toaster position="top-right" />
        <Suspense fallback={<PageLoader />}>
          <RequireRole roles={['OFFICER', 'ADMIN', 'AUDITOR']}>
            <StaffApp />
          </RequireRole>
        </Suspense>
      </>
    );
  }

  const citizenRoles: Role[] = ['CITIZEN', 'HELPER'];

  return (
    <>
      <PrototypeBanner />
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to={user ? homePathFor(user.role) : '/login'} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/transparency" element={<CitizenShell public><TransparencyPage /></CitizenShell>} />
        <Route path="/scam-check" element={<CitizenShell public><ScamCheck /></CitizenShell>} />

        <Route
          path="/c/*"
          element={
            <RequireRole roles={citizenRoles}>
              <RequireCitizenContext>
                <CitizenShell>
                  <Routes>
                    <Route index element={<CitizenHome />} />
                    <Route path="apply" element={<ApplyStart />} />
                    <Route path="apply/:localId" element={<Wizard />} />
                    <Route path="cases" element={<CasesList />} />
                    <Route path="cases/:id" element={<CaseStatusPage />} />
                    <Route path="consent" element={<ConsentCenter />} />
                    <Route path="my-data" element={<MyData />} />
                    <Route path="ask" element={<AskPage />} />
                    <Route path="*" element={<Navigate to="/c" replace />} />
                  </Routes>
                </CitizenShell>
              </RequireCitizenContext>
            </RequireRole>
          }
        />

        <Route
          path="/h/*"
          element={
            <RequireRole roles={['HELPER']}>
              <CitizenShell>
                <Routes>
                  <Route index element={<FamilyRoster />} />
                  <Route path="new" element={<AddFamily />} />
                  <Route path="switch/:citizenId" element={<SwitchInterstitial />} />
                  <Route path="*" element={<Navigate to="/h" replace />} />
                </Routes>
              </CitizenShell>
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}
