import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAudio } from '../shared/audio/AudioProvider';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { useOffline } from '../shared/offline/OfflineProvider';
import { BrandMark } from '../shared/ui/Brand';
import { OfflinePill } from '../shared/ui/OfflinePill';
import {
  IconGlobe,
  IconHome,
  IconList,
  IconLogout,
  IconShield,
  IconSpeaker,
  IconUsers,
} from '../shared/ui/Icons';

export function CitizenLayout() {
  const { t, toggleLang, lang } = useI18n();
  const { session, actFor, logout } = useAuth();
  const { lite, toggle: toggleLite } = useLiteMode();
  const { autoRead, setAutoRead } = useAudio();
  const { needsAttention, retryOne, discardOne } = useOffline();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const focused = pathname.startsWith('/c/apply/');
  const nextLangLabel = lang === 'ur' ? 'سنڌي' : lang === 'sd' ? 'EN' : 'اردو';
  const isHelper = session?.user.role === 'HELPER';
  const hasWorkspace = !isHelper || Boolean(actFor);

  if (!hasWorkspace && pathname.replace(/\/$/, '') !== '/c/ask') {
    return <Navigate to="/h" replace />;
  }

  const navItems = hasWorkspace ? [
    { to: '/c', label: t('nav.home'), Icon: IconHome, end: true },
    { to: '/c/cases', label: t('nav.cases'), Icon: IconList, end: false },
    { to: '/scam-check', label: t('nav.scam'), Icon: IconShield, end: false },
    { to: '/c/consent', label: isHelper ? t('nav.permissions') : t('nav.data'), Icon: IconUsers, end: false },
  ] : [
    { to: '/h', label: t('helper.title'), Icon: IconUsers, end: true },
    { to: '/scam-check', label: t('nav.scam'), Icon: IconShield, end: false },
  ];

  return (
    <div className="flex min-h-[calc(100dvh-var(--banner-h))] flex-col">
      <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-2">
          <BrandMark size={24} />
          <span className="text-body-lg font-semibold tracking-tight text-ink">{t('app.name')}</span>
          <OfflinePill compact />
          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAutoRead(!autoRead)}
              aria-pressed={autoRead}
              aria-label={t('common.autoRead')}
              title={t('common.autoRead')}
              className={`press grid h-tap w-tap place-items-center rounded-control transition-colors ${
                autoRead ? 'bg-accent text-white shadow-sm' : 'bg-card border border-ink/[0.12] text-accent-ink hover:bg-accent-wash'
              }`}
            >
              <IconSpeaker size={18} />
            </button>
            <button
              type="button"
              onClick={toggleLite}
              data-testid="lite-toggle"
              aria-pressed={lite}
              className={`press min-h-tap rounded-control px-2.5 text-meta font-medium transition-colors ${
                lite ? 'bg-accent text-white shadow-sm' : 'bg-card border border-ink/[0.12] text-ink-2 hover:bg-raised hover:text-ink'
              }`}
              title={t('common.liteMode')}
            >
              {t('common.liteMode')}
            </button>
            <button
              type="button"
              onClick={toggleLang}
              data-testid="lang-toggle"
              className="press inline-flex min-h-tap items-center gap-1 rounded-control bg-card border border-ink/[0.12] px-2.5 text-meta font-medium text-ink-2 hover:bg-raised hover:text-ink"
              aria-label={t('common.switchLanguage')}
            >
              <IconGlobe size={14} />
              {nextLangLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }));
              }}
              className="press grid h-tap w-tap place-items-center rounded-control text-ink-3 hover:bg-raised hover:text-ink"
              aria-label={t('common.signOut')}
              title={t('common.signOut')}
            >
              <IconLogout size={18} />
            </button>
          </div>
        </div>

        {actFor && (
          <div className="bg-paused text-white">
            <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-1">
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-meta font-medium"
                style={{ backgroundColor: actFor.avatarColor }}
              >
                {actFor.fullName.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-meta font-medium">
                {t('home.helperStrip')}: {actFor.fullName}
              </span>
              <NavLink
                to="/h"
                className="press inline-flex min-h-tap shrink-0 items-center rounded-[6px] bg-white/15 px-3 text-meta font-medium hover:bg-white/25"
              >
                {t('home.switchFamily')}
              </NavLink>
            </div>
          </div>
        )}

        {needsAttention.length > 0 && (
          <div role="alert" className="border-t border-negative/20 bg-negative-wash">
            <div className="mx-auto flex w-full max-w-[560px] flex-col gap-1.5 px-4 py-2 text-caption text-negative">
              <p className="font-medium">
                {t('common.error')} ({needsAttention.length})
              </p>
              {needsAttention.slice(0, 2).map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 text-meta">
                  <span className="truncate">{row.lastError || row.label}</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => row.id !== undefined && void retryOne(row.id)}
                      className="rounded border border-negative/30 bg-card px-2 py-1 text-meta font-medium text-ink"
                    >
                      {t('common.retry')}
                    </button>
                    <button
                      type="button"
                      onClick={() => row.id !== undefined && void discardOne(row.id)}
                      className="rounded px-2 py-1 text-meta text-negative hover:bg-negative/10"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {!focused && (
        <nav aria-label={t('nav.main')} className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/[0.08] bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
          <ul className="mx-auto flex w-full max-w-[560px]">
            {navItems.map(({ to, label, Icon, end }) => (
              <li key={to} className="min-w-0 flex-1">
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `relative flex min-h-primary flex-col items-center justify-center gap-1 px-1 py-2 text-meta font-medium leading-[1.4] ${
                      isActive ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-raised'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden
                        className={`absolute inset-x-3 top-0 h-px ${isActive ? 'bg-accent' : 'bg-transparent'}`}
                      />
                      <Icon size={20} />
                      <span className="line-clamp-2 text-center">{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

    </div>
  );
}
