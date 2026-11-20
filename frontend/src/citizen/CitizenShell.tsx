import { AudioLines, Feather, Languages, LogIn, LogOut, Repeat, Smartphone, Volume2, VolumeX, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../shared/auth/session';
import { homePathFor, useAuth } from '../shared/auth/store';
import { langStore, useT } from '../shared/i18n';
import { settingsStore, useSettings } from '../shared/settings';
import { ConnectivityIcon, ConnectivityStrip } from '../shared/ui/ConnectivityPill';
import { cx } from '../shared/ui/cx';
import { AjrakPattern, HaqdaarMark } from '../shared/ui/AjrakPattern';

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

  const tips = [
    { icon: Smartphone, text: t('deskTip1') },
    { icon: AudioLines, text: t('deskTip2') },
    { icon: WifiOff, text: t('deskTip3') },
  ];

  return (
    <div className="relative min-h-[calc(100dvh-28px)] lg:flex lg:items-start lg:justify-center lg:gap-14 lg:bg-sunken lg:px-8 lg:py-8">
      {/* Desktop only: the citizen app is phone-first, so on wide screens it sits in a framed
          column beside a short context panel instead of floating in empty space. */}
      <AjrakPattern className="hidden text-line-strong/[0.09] lg:block" />
      <aside className="sticky top-[60px] hidden w-[320px] shrink-0 lg:block">
        <HaqdaarMark className="h-14 w-14" />
        <h2 className="mt-6 text-3xl font-bold leading-tight">{t('deskTitle')}</h2>
        <p className="mt-3 text-muted">{t('deskBody')}</p>
        <ul className="mt-6 space-y-3">
          {tips.map((tip) => (
            <li key={tip.text} className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-brand ring-1 ring-line">
                <tip.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="pt-1.5 text-sm font-medium">{tip.text}</span>
            </li>
          ))}
        </ul>
      </aside>
      <div className="relative mx-auto flex min-h-[calc(100dvh-28px)] w-full max-w-xl flex-col bg-page lg:mx-0 lg:min-h-[calc(100dvh-28px-4rem)] lg:max-w-[440px] lg:overflow-clip lg:rounded-[2rem] lg:border lg:border-line lg:shadow-lift">
      <header className="sticky top-[28px] z-40 border-b border-line bg-page/95 backdrop-blur supports-[backdrop-filter]:bg-page/80">
        <div className="flex items-center gap-2 px-3 py-2">
          <Link
            to={user ? homePathFor(user.role) : '/login'}
            className="flex items-center gap-2 rounded-full pe-2 text-lg font-bold text-brand"
            aria-label={t('home')}
          >
            <HaqdaarMark className="h-9 w-9 rounded-xl" />
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
      <main id="main" className="flex-1 px-4 pb-16 pt-5">
        {children}
      </main>
      </div>
    </div>
  );
}
