import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { roleHome } from '../auth/roleHome';
import { useI18n } from '../i18n/I18nProvider';
import { BrandMark } from './Brand';
import { IconChevron } from './Icons';

/**
 * Chrome for the two routes that work without a login (F-14, F-31).
 *
 * They sit outside CitizenLayout on purpose — a woman who has not signed up
 * must still be able to check a message — but that left them with no brand and
 * no way out, so tapping the "Message" tab from the citizen shell dropped her
 * into a screen with no tab bar and no back link.
 *
 * This is the smallest bar that fixes both: who this is, and one link out. It
 * matches the citizen header's height and hairline so the two shells read as
 * the same product.
 */
export function PublicHeader() {
  const { t } = useI18n();
  const { session, actFor } = useAuth();
  const role = session?.user.role;
  const home = role === 'HELPER' && actFor ? '/c' : session ? roleHome(session.user) : '/login';
  return (
    <header className="sticky top-[var(--banner-h)] z-40 border-b border-ink/[0.08] bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-4 py-2">
        <BrandMark size={22} />
        <span className="text-body-lg font-medium tracking-tight text-ink">{t('app.name')}</span>
        <Link
          to={home}
          className="press -me-2 ms-auto inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-caption font-medium text-ink-2 hover:bg-raised hover:text-ink"
        >
          {role ? t('home.backToDashboard') : t('login.signIn')}
          <IconChevron size={14} />
        </Link>
      </div>
    </header>
  );
}
