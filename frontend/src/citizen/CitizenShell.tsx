import {
  ArrowUpRight,
  Feather,
  FolderOpen,
  Home,
  Languages,
  LogOut,
  MessageCircleQuestion,
  Repeat,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  Volume2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../shared/auth/session';
import { homePathFor, useAuth } from '../shared/auth/store';
import { langStore, useT } from '../shared/i18n';
import { settingsStore, useSettings } from '../shared/settings';
import { ConnectivityIcon, ConnectivityStrip } from '../shared/ui/ConnectivityPill';
import { cx } from '../shared/ui/cx';
import { HaqdaarMark } from '../shared/ui/AjrakPattern';
import { Modal } from '../shared/ui/Modal';

export function CitizenShell({
  children,
  public: isPublic = false,
}: {
  children: ReactNode;
  public?: boolean;
}) {
  const { t, lang, pick } = useT();
  const { user, actingFor } = useAuth();
  const settings = useSettings();
  const nav = useNavigate();
  const location = useLocation();
  const [preferences, setPreferences] = useState(false);
  const wizard = location.pathname.includes('/apply');
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  const home = user ? homePathFor(user.role) : '/login';
  const citizenContext = user?.role === 'CITIZEN' || (user?.role === 'HELPER' && actingFor);
  const links = citizenContext
    ? [
        { to: '/c', label: t('home'), icon: Home },
        { to: '/c/cases', label: pick('درخواستیں', 'Applications'), icon: FolderOpen },
        { to: '/scam-check', label: pick('پیغام چیک', 'Check message'), icon: ShieldQuestion },
        { to: '/c/consent', label: pick('اجازت', 'Permissions'), icon: ShieldCheck },
      ]
    : [
        { to: home, label: user?.role === 'HELPER' ? t('helperTitle') : t('home'), icon: Home },
        { to: '/scam-check', label: t('tileScam'), icon: ShieldQuestion },
      ];
  const navLinks = (mobile = false) =>
    links.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        end={to === '/c' || to === home}
        className={({ isActive }) =>
          cx(
            mobile
              ? 'flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold'
              : 'flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold',
            'transition-colors',
            isActive
              ? 'bg-primary-soft text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )
        }
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        <span className="text-center">{label}</span>
      </NavLink>
    ));
  return (
    <div className="min-h-[calc(100dvh-28px)]">
      <a
        href="#main"
        className="sr-only-focusable fixed start-4 top-10 z-50 rounded-xl bg-card p-4 font-bold"
      >
        {pick('مرکزی مواد', 'Skip to content')}
      </a>
      <header className="sticky top-[var(--prototype-height,28px)] z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center gap-3 px-4 sm:min-h-[76px] sm:px-8">
          <Link to={home} className="flex items-center gap-3" aria-label={t('home')}>
            <HaqdaarMark className="h-9 w-9 rounded-xl sm:h-11 sm:w-11" />
            <span>
              <span className="block text-xl font-bold tracking-tight">{t('appName')}</span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:block">
                {pick('آپ کا حق، محفوظ طریقے سے', 'Your right. Delivered safely.')}
              </span>
            </span>
          </Link>
          <div className="ms-auto flex items-center gap-1 sm:gap-3">
            <span className="hidden sm:inline-flex">
              <ConnectivityIcon />
            </span>
            <button
              type="button"
              onClick={() => langStore.set(lang === 'ur' ? 'en' : 'ur')}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl px-2 text-xs font-semibold hover:bg-muted sm:px-3 sm:text-sm"
              aria-label={t('switchLang')}
            >
              <Languages className="h-4 w-4" aria-hidden />
              <span>{lang === 'ur' ? 'English' : 'اردو'}</span>
            </button>
            <button
              type="button"
              onClick={() => setPreferences(true)}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full hover:bg-muted"
              aria-label={pick('ترجیحات', 'Preferences')}
            >
              <Settings2 className="h-5 w-5" aria-hidden />
            </button>
            {!user && isPublic && (
              <Link
                to="/login"
                className="hidden rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground sm:block"
              >
                {t('loginTitle')}
              </Link>
            )}
          </div>
        </div>
        <ConnectivityStrip />
        {user?.role === 'HELPER' && actingFor && (
          <div className="flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-white">
            <span className="truncate font-semibold">{t('helpingStrip', { name: actingFor.name })}</span>
            <Link
              to="/h"
              className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3 font-semibold"
            >
              <Repeat className="h-4 w-4" aria-hidden />
              {t('switchFamily')}
            </Link>
          </div>
        )}
      </header>
      <div className="mx-auto flex max-w-[1440px] gap-10 px-4 sm:px-8 lg:gap-14">
        <aside className="sticky top-[128px] hidden h-[calc(100dvh-148px)] w-56 shrink-0 flex-col py-8 lg:flex">
          {user && (
            <>
              <p className="eyebrow mb-4 px-4">{pick('آپ کی جگہ', 'Your workspace')}</p>
              <nav aria-label={pick('مرکزی نیویگیشن', 'Main navigation')} className="space-y-2">
                {navLinks()}
              </nav>
            </>
          )}
          <div className="mt-8 rounded-2xl bg-primary-soft p-5">
            <MessageCircleQuestion className="h-7 w-7 text-primary" aria-hidden />
            <h2 className="mt-3 font-bold">{pick('ہم آپ کے ساتھ ہیں', 'A little help goes a long way.')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {pick(
                'پالیسی یا درخواست کے بارے میں سوال ہے؟ یہاں پوچھیں۔',
                'Questions about a grant or your next step? Ask in your own words.',
              )}
            </p>
            <Link
              to={citizenContext ? '/c/ask' : home}
              className="mt-4 inline-flex min-h-12 items-center gap-2 text-sm font-bold text-primary"
            >
              {t('askQuestion')}
              <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </div>
          <div className="mt-auto pt-8">
            {user && (
              <div className="mb-4 flex items-center gap-3 border-t border-border pt-5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-highlight-soft font-bold text-highlight"
                  aria-hidden
                >
                  {user.full_name.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pick('آپ کا ذاتی اکاؤنٹ', 'Your personal account')}
                  </p>
                </div>
              </div>
            )}
            <Link
              to="/transparency"
              className="flex min-h-12 items-center gap-2 text-xs text-muted-foreground hover:text-primary"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {pick('اس پروٹوٹائپ کے بارے میں', 'About this prototype')}
            </Link>
          </div>
        </aside>
        <main
          id="main"
          tabIndex={-1}
          className={cx(
            'citizen-content min-w-0 flex-1 pb-28 pt-4 outline-none sm:pt-8 lg:pb-12',
            wizard && 'mx-auto max-w-2xl',
          )}
        >
          {children}
        </main>
      </div>
      {user && !wizard && (
        <nav
          aria-label={pick('موبائل نیویگیشن', 'Mobile navigation')}
          className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
        >
          {navLinks(true)}
        </nav>
      )}
      <Modal
        open={preferences}
        onClose={() => setPreferences(false)}
        title={pick('اپنے لیے آسان بنائیں', 'Make yourself comfortable')}
        description={pick(
          'یہ ترجیحات اس فون پر محفوظ رہتی ہیں۔',
          'These preferences stay saved on this device.',
        )}
        placement="sheet"
        closeLabel={t('close')}
      >
        <div className="space-y-3">
          {[
            {
              icon: Volume2,
              title: t('autoRead'),
              body: pick('ہر نیا صفحہ آواز سے سنیں', 'Hear each new screen read aloud'),
              value: settings.autoRead,
              toggle: () => settingsStore.set({ autoRead: !settings.autoRead }),
            },
            {
              icon: Feather,
              title: t('liteMode'),
              body: pick('کمزور سگنل پر کم ڈیٹا استعمال کریں', 'Use less data on a weak connection'),
              value: settings.liteMode,
              toggle: () => settingsStore.set({ liteMode: !settings.liteMode, liteModeManual: true }),
            },
          ].map(({ icon: Icon, title, body, value, toggle }) => (
            <button
              key={title}
              type="button"
              role="switch"
              aria-checked={value}
              onClick={toggle}
              className="flex min-h-20 w-full items-center gap-3 rounded-2xl border border-border p-4 text-start hover:bg-muted"
            >
              <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span className="flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="text-xs text-muted-foreground">{body}</span>
              </span>
              <span
                aria-hidden
                className={cx(
                  'flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors',
                  value ? 'justify-end bg-primary' : 'justify-start bg-input',
                )}
              >
                <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
              </span>
            </button>
          ))}
          {user && (
            <button
              type="button"
              onClick={() => {
                setPreferences(false);
                void logout();
                nav('/login');
              }}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-danger hover:bg-danger-soft"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {t('logout')}
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
