import { Feather, Languages, LogIn, LogOut, Repeat, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../shared/auth/session';
import { homePathFor, useAuth } from '../shared/auth/store';
import { langStore, useT } from '../shared/i18n';
import { settingsStore, useSettings } from '../shared/settings';
import { ConnectivityIcon, ConnectivityStrip } from '../shared/ui/ConnectivityPill';
import { cx } from '../shared/ui/cx';

function IconToggle({ pressed, onClick, label, children }: { pressed?: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cx(
        'inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full px-1.5 text-sm font-semibold transition-colors duration-fast',
        pressed ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-sunken',
      )}
    >
      {children}
    </button>
  );
}

export function CitizenShell({ children, public: isPublic = false }: { children: ReactNode; public?: boolean }) {
  const { t, lang } = useT();
  const { user, actingFor } = useAuth();
  const settings = useSettings();
  const nav = useNavigate();

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-28px)] max-w-xl flex-col">
      <header className="sticky top-[28px] z-40 border-b border-line bg-page/95 backdrop-blur supports-[backdrop-filter]:bg-page/80">
        <div className="flex items-center gap-2 px-3 py-2">
          <Link
            to={user ? homePathFor(user.role) : '/login'}
            className="flex items-center gap-2 rounded-full pe-2 text-lg font-bold text-brand"
            aria-label={t('home')}
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-brand-ink" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M7 5v14M17 5v14M7 12h10" />
              </svg>
            </span>
            <span>{t('appName')}</span>
          </Link>
          <div className="ms-auto flex min-w-0 items-center gap-0.5">
            <ConnectivityIcon />
            <IconToggle onClick={() => langStore.set(lang === 'ur' ? 'en' : 'ur')} label={t('switchLang')}>
              <Languages className="h-5 w-5" aria-hidden />
              <span className={lang === 'ur' ? 'font-sans text-xs' : 'font-urdu text-sm'}>{lang === 'ur' ? 'EN' : 'اردو'}</span>
            </IconToggle>
            <IconToggle
              pressed={settings.autoRead}
              onClick={() => settingsStore.set({ autoRead: !settings.autoRead })}
              label={t('autoRead')}
            >
              {settings.autoRead ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
            </IconToggle>
            <IconToggle
              pressed={settings.liteMode}
              onClick={() => settingsStore.set({ liteMode: !settings.liteMode, liteModeManual: true })}
              label={t('liteMode')}
            >
              <Feather className="h-5 w-5" aria-hidden />
            </IconToggle>
            {user ? (
              <IconToggle
                onClick={() => {
                  void logout();
                  nav('/login');
                }}
                label={t('logout')}
              >
                <LogOut className="h-5 w-5" aria-hidden />
              </IconToggle>
            ) : (
              isPublic && (
                <Link to="/login" aria-label={t('loginTitle')} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken">
                  <LogIn className="h-5 w-5" aria-hidden />
                </Link>
              )
            )}
          </div>
        </div>
        <ConnectivityStrip />
        {user?.role === 'HELPER' && actingFor && (
          <div className="flex items-center gap-3 px-3 py-2 text-white" style={{ backgroundColor: actingFor.avatarColor }}>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-sm font-bold" aria-hidden>
              {actingFor.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold" style={{ textShadow: '0 1px 2px rgb(0 0 0 / 0.35)' }}>
              {t('helpingStrip', { name: actingFor.name })}
            </span>
            <Link
              to="/h"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-black/30 px-3 text-sm font-semibold hover:bg-black/40"
            >
              <Repeat className="h-4 w-4" aria-hidden />
              {t('switchFamily')}
            </Link>
          </div>
        )}
      </header>
      <main id="main" className="flex-1 px-4 pb-28 pt-4">
        {children}
      </main>
    </div>
  );
}
