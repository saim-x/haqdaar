import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';
import { BrandMark } from './Brand';
import { IconChevron, IconGlobe } from './Icons';

export function PublicHeader() {
  const { t, lang, toggleLang } = useI18n();
  const { session } = useAuth();
  const nextLabel = lang === 'ur' ? 'سنڌي' : lang === 'sd' ? 'EN' : 'اردو';
  return (
    <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-2">
        <BrandMark size={22} />
        <span className="text-body-lg font-medium tracking-tight text-ink">{t('app.name')}</span>
        <div className="ms-auto flex items-center gap-1">
          <button
            type="button"
            onClick={toggleLang}
            aria-label={t('common.switchLanguage')}
            className="press inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-meta font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            <IconGlobe size={14} />
            {nextLabel}
          </button>
          <Link
            to={session ? '/c' : '/login'}
            className="press -me-2 inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-caption font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            {session ? t('common.goHome') : t('login.signIn')}
            <IconChevron size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
