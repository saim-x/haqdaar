import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { OfflinePill } from '../shared/ui/OfflinePill';
import { IconGlobe, IconHome, IconList, IconLogout, IconQuestion, IconShield, IconUsers } from '../shared/ui/Icons';

/**
 * Citizen shell — docs/11 §3.1.
 * Bottom navigation is icon + label (never icon-only), 56 px tall, and the
 * helper strip appears above it whenever a helper is acting for a family.
 */
export function CitizenLayout() {
  const { t, toggleLang, lang } = useI18n();
  const { session, actFor, logout } = useAuth();
  const { lite, toggle: toggleLite } = useLiteMode();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The wizard owns the bottom of the screen: its own action bar would sit
  // underneath the tab bar, so the tab bar steps aside for the whole flow.
  const focused = pathname.startsWith('/c/apply/');

  const navItems = [
    { to: '/c', label: t('home.apply'), Icon: IconHome, end: true },
    { to: '/c/cases', label: t('home.cases'), Icon: IconList, end: false },
    { to: '/scam-check', label: t('home.scam'), Icon: IconShield, end: false },
    { to: '/c/consent', label: t('home.data'), Icon: IconUsers, end: false },
  ];

  return (
    <div className="flex min-h-[calc(100dvh-28px)] flex-col">
      <header className="sticky top-7 z-40 border-b border-ink/10 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[520px] items-center gap-2 px-3 py-2">
          <span className="text-base font-bold text-teal-700">{t('app.name')}</span>
          <OfflinePill compact />
          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleLite}
              aria-pressed={lite}
              className={`min-h-tap rounded-full px-2.5 text-xs font-bold ${
                lite ? 'bg-teal-600 text-white' : 'bg-ink/5 text-ink-soft'
              }`}
              title={t('common.liteMode')}
            >
              {t('common.liteMode')}
            </button>
            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex min-h-tap items-center gap-1 rounded-full bg-ink/5 px-2.5 text-xs font-bold text-ink-soft"
              aria-label={t('common.switchLanguage')}
            >
              <IconGlobe size={14} />
              {lang === 'ur' ? 'EN' : 'اردو'}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }));
              }}
              className="grid h-tap w-tap place-items-center rounded-full text-ink-soft hover:bg-ink/5"
              aria-label={t('common.signOut')}
              title={t('common.signOut')}
            >
              <IconLogout size={18} />
            </button>
          </div>
        </div>

        {actFor && (
          <div className="bg-[#6D28D9] text-white">
            <div className="mx-auto flex w-full max-w-[520px] items-center gap-2 px-3 py-1.5">
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold"
                style={{ backgroundColor: actFor.avatarColor }}
              >
                {actFor.fullName.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {t('home.helperStrip')}: {actFor.fullName}
              </span>
              <NavLink
                to="/h"
                className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold"
              >
                {t('home.switchFamily')}
              </NavLink>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {!focused && (
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto grid w-full max-w-[520px] grid-cols-4">
          {navItems.map(({ to, label, Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-primary flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-semibold leading-tight ${
                    isActive ? 'text-teal-700' : 'text-ink-soft'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={22} className={isActive ? 'text-teal-700' : 'text-ink-soft'} />
                    <span className="line-clamp-2 text-center">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      )}

      {!focused && (
        <NavLink
          to="/c/ask"
          className="fixed bottom-20 end-4 z-40 inline-flex min-h-primary items-center gap-2 rounded-full bg-teal-700 px-4 text-sm font-bold text-white shadow-card"
        >
          <IconQuestion size={20} />
          {t('home.ask')}
        </NavLink>
      )}

      {!focused && session?.user.role === 'HELPER' && !actFor && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
          <p className="pointer-events-auto mx-auto max-w-[520px] rounded-2xl bg-[#6D28D9] px-4 py-2 text-center text-xs font-semibold text-white">
            {t('helper.title')} — {t('home.switchFamily')}
          </p>
        </div>
      )}
    </div>
  );
}
