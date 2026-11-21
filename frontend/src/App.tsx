import { Suspense, lazy } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './shared/auth/AuthProvider';
import { RedirectIfAuthed, RequireRole } from './shared/auth/guards';
import { LoginPage } from './shared/auth/LoginPage';
import { roleHome } from './shared/auth/roleHome';
import { useI18n } from './shared/i18n/I18nProvider';
import { useLiteMode } from './shared/lite/LiteModeProvider';
import { BrandMark } from './shared/ui/Brand';
import { IconGlobe, IconLogout } from './shared/ui/Icons';
import { OfflinePill } from './shared/ui/OfflinePill';
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
const WelcomeTour = lazy(() => import('./shared/ui/WelcomeTour').then((m) => ({ default: m.WelcomeTour })));

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div
      className="grid min-h-[50dvh] place-items-center px-6 text-center text-caption text-ink-3"
      role="status"
    >
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
  const { t } = useI18n();
  return (
    <div className="grid min-h-[calc(100dvh-var(--banner-h))] place-items-center px-5">
      <div className="card enter w-full max-w-[420px] px-6 py-8 text-center">
        <p className="num font-mono text-meta text-ink-3">404</p>
        <h1 className="mt-2 text-title font-medium leading-[1.4] text-ink">{t('notFound.title')}</h1>
        <p className="mt-2 text-body leading-[1.7] text-ink-2">{t('notFound.hint')}</p>
        <Link
          to="/"
          className="press mt-6 inline-flex min-h-primary items-center rounded-control bg-accent px-6 text-body-lg font-medium text-white hover:bg-accent-ink"
        >
          {t('common.goHome')}
        </Link>
      </div>
    </div>
  );
}

/** Helper shell — compact bar with offline status, Lite mode, 3-way language, and sign out. */
function HelperLayout() {
  const { t, lang, toggleLang } = useI18n();
  const { lite, toggle: toggleLite } = useLiteMode();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const nextLangLabel = lang === 'ur' ? 'سنڌي' : lang === 'sd' ? 'EN' : 'اردو';
  return (
    <div className="min-h-[calc(100dvh-var(--banner-h))]">
      <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[560px] items-center gap-1.5 px-4 py-2">
          <BrandMark size={22} />
          <span className="text-body-lg font-medium tracking-tight text-ink">{t('app.name')}</span>
          <OfflinePill compact />
          <div className="ms-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={toggleLite}
              aria-pressed={lite}
              className={`press min-h-tap rounded-control px-2 text-meta font-medium ${
                lite ? 'bg-accent-wash text-accent-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {t('common.liteMode')}
            </button>
            <button
              type="button"
              onClick={toggleLang}
              aria-label={t('common.switchLanguage')}
              className="press inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-meta font-medium text-ink-2 hover:text-ink"
            >
              <IconGlobe size={14} />
              {nextLangLabel}
            </button>
            <button
              type="button"
              onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
              aria-label={t('common.signOut')}
              title={t('common.signOut')}
              className="press grid h-tap w-tap place-items-center rounded-control text-ink-3 hover:bg-raised hover:text-ink"
            >
              <IconLogout size={18} />
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[560px]">
        <Outlet />
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const { session } = useAuth();

  return (
    <div className="min-h-dvh bg-paper">
      <PrototypeBanner />
      {session && (
        <Suspense fallback={null}>
          <WelcomeTour key={`${session.user.role}:${session.user.id}`} accountId={session.user.id} role={session.user.role} />
        </Suspense>
      )}
      <div id="tour-content">
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
    </div>
  );
}
