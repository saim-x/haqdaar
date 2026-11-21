import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { BrandMark } from '../shared/ui/Brand';
import { OfflinePill } from '../shared/ui/OfflinePill';
import { IconGlobe, IconHome, IconList, IconLogout, IconShield, IconUsers } from '../shared/ui/Icons';

/**
 * Citizen shell — docs/11 §3.1.
 *
 * The column is 560px because this is a phone app, not a website. On a wide
 * screen it sits inside a hairline frame on the paper backdrop, so it reads as a
 * device rather than a narrow page floating in a dead band.
 *
 * The bottom bar is icon + label (never icon-only), 56px tall, and the active
 * item is marked by the signature hairline rule at its top edge — the same 1px
 * line used for every divider in the app — not by colour alone.
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
    { to: '/c', label: t('nav.home'), Icon: IconHome, end: true },
    { to: '/c/cases', label: t('nav.cases'), Icon: IconList, end: false },
    { to: '/scam-check', label: t('nav.scam'), Icon: IconShield, end: false },
    { to: '/c/consent', label: t('nav.data'), Icon: IconUsers, end: false },
  ];

  return (
    <div className="flex min-h-[calc(100dvh-var(--banner-h))] flex-col">
      <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-2">
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
              title={t('common.liteMode')}
            >
              {t('common.liteMode')}
            </button>
            <button
              type="button"
              onClick={toggleLang}
              className="press inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-meta font-medium text-ink-3 hover:text-ink"
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
            <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-1.5">
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
                className="press shrink-0 rounded-[6px] bg-white/15 px-2 py-1 text-meta font-medium hover:bg-white/25"
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
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/[0.08] bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
          <ul className="mx-auto grid w-full max-w-[560px] grid-cols-4">
            {navItems.map(({ to, label, Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `relative flex min-h-primary flex-col items-center justify-center gap-1 px-1 py-2 text-meta font-medium leading-[1.4] ${
                      isActive ? 'text-accent-ink' : 'text-ink-3'
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

      {!focused && session?.user.role === 'HELPER' && !actFor && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[136px] z-30 px-4">
          <p className="pointer-events-auto mx-auto max-w-[560px] rounded-control bg-paused px-4 py-2 text-center text-meta font-medium text-white">
            {t('helper.title')} — {t('home.switchFamily')}
          </p>
        </div>
      )}
    </div>
  );
}
