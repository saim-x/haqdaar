import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { roleHome } from '../auth/roleHome';
import { useI18n } from '../i18n/I18nProvider';
import { BrandLockup } from './Brand';
import { LanguageSelector } from './LanguageSelector';
import { IconChevron } from './Icons';

export function PublicHeader() {
  const { t } = useI18n();
  const { session, actFor } = useAuth();
  const role = session?.user.role;
  const home = role === 'HELPER' && actFor ? '/c' : session ? roleHome(session.user) : '/login';
  return (
    <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-2">
        <Link to={home} className="shrink-0" aria-label={t('app.name')}>
          <BrandLockup height={22} alt={t('app.name')} />
        </Link>
        <div className="ms-auto flex items-center gap-1">
          <LanguageSelector className="border-transparent bg-transparent px-2 hover:border-ink/[0.12]" />
          <Link
            to={home}
            className="press -me-2 inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-caption font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            {role ? t('home.backToDashboard') : t('login.signIn')}
            <IconChevron size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
