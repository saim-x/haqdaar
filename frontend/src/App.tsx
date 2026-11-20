import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './shared/auth/AuthProvider';
import { RedirectIfAuthed, RequireRole } from './shared/auth/guards';
import { LoginPage } from './shared/auth/LoginPage';
import { roleHome } from './shared/auth/roleHome';
import { useI18n } from './shared/i18n/I18nProvider';
import { PrototypeBanner } from './shared/ui/PrototypeBanner';
import { CitizenLayout } from './citizen/CitizenLayout';
import { CitizenHome } from './citizen/Home';

/* Lazy chunks — none of these may land in the citizen entry chunk (budget rule). */
const CasesPage = lazy(() => import('./citizen/CasesPage').then((m) => ({ default: m.CasesPage })));
const CaseStatusPage = lazy(() => import('./citizen/CaseStatusPage').then((m) => ({ default: m.CaseStatusPage })));
const ConsentPage = lazy(() => import('./citizen/ConsentPage').then((m) => ({ default: m.ConsentPage })));
const MyDataPage = lazy(() => import('./citizen/MyDataPage').then((m) => ({ default: m.MyDataPage })));
const AskPage = lazy(() => import('./citizen/AskPage').then((m) => ({ default: m.AskPage })));
const ApplyWizard = lazy(() => import('./citizen/ApplyWizard').then((m) => ({ default: m.ApplyWizard })));
const ScamCheckPage = lazy(() => import('./citizen/ScamCheckPage').then((m) => ({ default: m.ScamCheckPage })));
const TransparencyPage = lazy(() => import('./citizen/TransparencyPage').then((m) => ({ default: m.TransparencyPage })));
const HelperRosterPage = lazy(() => import('./helper/HelperApp').then((m) => ({ default: m.HelperRosterPage })));
const AddFamilyPage = lazy(() => import('./helper/HelperApp').then((m) => ({ default: m.AddFamilyPage })));
const StaffRoutes = lazy(() => import('./staff/StaffApp').then((m) => ({ default: m.StaffRoutes })));

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-[50dvh] place-items-center px-6 text-center text-sm text-ink-soft" role="status">
      {t('common.loading')}
    </div>
  );
}

function RootRedirect() {
  const { status, session } = useAuth();
  if (status === 'loading') return <RouteFallback />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(session.user.role)} replace />;
}

function NotFound() {
  const { t, lang } = useI18n();
  return (
    <div className="screen">
      <div className="card mt-8 p-6 text-center">
        <p className="num text-4xl font-bold text-ink-soft">404</p>
        <p className="mt-2 text-sm text-ink-soft">
          {lang === 'ur' ? 'یہ صفحہ موجود نہیں۔' : 'This page does not exist.'}
        </p>
        <a href="/" className="mt-4 inline-flex min-h-primary items-center rounded-2xl bg-teal-600 px-5 text-sm font-bold text-white">
          {t('app.name')}
        </a>
      </div>
    </div>
  );
}

/** Helper shell — the roster and add-family screens own their own layout. */
function HelperLayout() {
  return (
    <div className="mx-auto w-full max-w-[520px] px-3 pb-8">
      <Outlet />
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <div className="min-h-dvh bg-paper">
      <PrototypeBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location}>
          <Route path="/" element={<RootRedirect />} />
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            }
          />

          {/* Public — zero login (F-14, F-31). */}
          <Route path="/scam-check" element={<ScamCheckPage />} />
          <Route path="/transparency" element={<TransparencyPage />} />

          {/* Citizen PWA */}
          <Route
            path="/c"
            element={
              <RequireRole roles={['CITIZEN', 'HELPER']}>
                <CitizenLayout />
              </RequireRole>
            }
          >
            <Route index element={<CitizenHome />} />
            <Route path="cases" element={<CasesPage />} />
            <Route path="cases/:id" element={<CaseStatusPage />} />
            <Route path="apply/:caseId" element={<ApplyWizard />} />
            <Route path="consent" element={<ConsentPage />} />
            <Route path="my-data" element={<MyDataPage />} />
            <Route path="ask" element={<AskPage />} />
          </Route>

          {/* Helper Mode */}
          <Route
            path="/h"
            element={
              <RequireRole roles={['HELPER']}>
                <HelperLayout />
              </RequireRole>
            }
          >
            <Route index element={<HelperRosterPage />} />
            <Route path="new" element={<AddFamilyPage />} />
          </Route>

          {/* Staff consoles — lazy, never in the citizen entry chunk. */}
          <Route
            path="/staff/*"
            element={
              <RequireRole roles={['OFFICER', 'ADMIN', 'AUDITOR']}>
                <StaffRoutes />
              </RequireRole>
            }
          />
          <Route
            path="/admin/*"
            element={
              <RequireRole roles={['ADMIN']}>
                <StaffRoutes />
              </RequireRole>
            }
          />
          <Route
            path="/auditor/*"
            element={
              <RequireRole roles={['AUDITOR', 'ADMIN']}>
                <StaffRoutes />
              </RequireRole>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}
