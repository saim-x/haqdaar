import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { BrandMark } from '../shared/ui/Brand';
import { LanguageSelector } from '../shared/ui/LanguageSelector';
import { IconLogout } from '../shared/ui/Icons';
import { OfflinePill } from '../shared/ui/OfflinePill';

export function HelperLayout() {
  const { logout } = useAuth();
  const { t } = useI18n();
  const { lite, toggle: toggleLite } = useLiteMode();
  const navigate = useNavigate();

  return (
    <div>
      <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[560px] items-center gap-1.5 px-4 py-1.5">
          <BrandMark size={22} />
          <span className="text-body font-semibold text-ink">{t('app.name')}</span>
          <OfflinePill compact />
          <button
            type="button"
            onClick={toggleLite}
            aria-pressed={lite}
            className={`press ms-auto min-h-tap shrink-0 rounded-control px-2 text-meta font-medium ${
              lite ? 'bg-accent-wash text-accent-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {t('common.liteMode')}
          </button>
          <LanguageSelector className="border-transparent bg-transparent px-2 hover:border-ink/[0.12]" />
          <button
            type="button"
            onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
            aria-label={t('common.signOut')}
            title={t('common.signOut')}
            className="press grid h-tap w-tap shrink-0 place-items-center rounded-control text-ink-2 hover:bg-raised"
          >
            <IconLogout size={18} />
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[560px]">
        <Outlet />
      </main>
    </div>
  );
}
