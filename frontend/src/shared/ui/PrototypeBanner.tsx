import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';

/** Mandatory on every route (RULE-5, AC-25.1). Sticky, 28px+, never dismissible. */
export function PrototypeBanner({ forceEnglish = false }: { forceEnglish?: boolean }) {
  const { t, lang } = useT();
  const l = forceEnglish ? 'en' : lang;
  const text = forceEnglish
    ? 'PROTOTYPE. Not an official government service. Identity, payment & data services are simulated.'
    : t('prototypeBanner');
  return (
    <div
      role="note"
      aria-label="Prototype notice"
      lang={l}
      dir={l === 'ur' ? 'rtl' : 'ltr'}
      className="sticky top-0 z-50 flex min-h-[28px] items-center justify-center gap-2 bg-banner px-3 py-1 text-center text-xs font-medium text-banner-foreground"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
      <Link to="/transparency" className="shrink-0 font-bold underline underline-offset-2">
        {forceEnglish ? 'Real vs Simulated' : t('prototypeLink')}
      </Link>
    </div>
  );
}
