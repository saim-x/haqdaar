import { useI18n, type Lang } from '../i18n/I18nProvider';
import { IconGlobe } from './Icons';

const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'ur', label: 'اردو' },
  { value: 'sd', label: 'سنڌي' },
  { value: 'en', label: 'English' },
];

/** Shows the active language and lets people choose any supported language. */
export function LanguageSelector({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();

  return (
    <label
      className={`press relative inline-flex min-h-tap shrink-0 items-center gap-1 rounded-control border border-ink/[0.12] bg-card px-2.5 text-meta font-medium text-ink-2 hover:bg-raised hover:text-ink ${className}`}
    >
      <IconGlobe size={14} />
      <span aria-hidden="true">{LANGUAGES.find(({ value }) => value === lang)?.label ?? 'اردو'}</span>
      <select
        value={lang}
        onChange={(event) => setLang(event.currentTarget.value as Lang)}
        aria-label="Select language"
        data-testid="lang-toggle"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {LANGUAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
}
