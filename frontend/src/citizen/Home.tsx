import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { CaseView, Program } from '../shared/api/types';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { enqueue } from '../shared/offline/outbox';
import { AudioButton } from '../shared/ui/AudioButton';
import { IconCamera, IconChevron, IconDocument, IconShield, IconUsers } from '../shared/ui/Icons';
import { uuid } from '../shared/lib/uuid';

interface Tile {
  key: string;
  labelKey: 'home.apply' | 'home.cases' | 'home.scam' | 'home.data';
  audioKey: string;
  Icon: typeof IconDocument;
  accent: string;
  to?: string;
  onClick?: () => void;
}

/**
 * Citizen Home — docs/11 §3.1. Four giant pictogram tiles, each with its own
 * 🔊 label, plus the floating "Ask a Question" button rendered by the layout.
 */
export function CitizenHome() {
  const { t, lang } = useI18n();
  const { session, actFor } = useAuth();
  const { lite } = useLiteMode();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.get<{ items: Program[] }>('/programs'),
    staleTime: 10 * 60 * 1000,
  });

  const startApplication = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const program = programs.data?.items[0];
      if (!program) {
        setError(lang === 'ur' ? 'پروگرام دستیاب نہیں۔' : 'No program available.');
        return;
      }
      const created = await api.post<CaseView>('/cases', {
        program_id: program.id,
        case_type: 'BENEFIT_APPLICATION',
      });
      navigate(`/c/apply/${created.id}`);
    } catch (err) {
      // Offline: queue the case creation and continue with a local id so the
      // wizard still works. The outbox replays it exactly once on reconnect.
      const localId = uuid();
      try {
        await enqueue({
          method: 'POST',
          path: '/cases',
          body: { program_id: programs.data?.items[0]?.id, case_type: 'BENEFIT_APPLICATION' },
          citizenId: actFor?.citizenId ?? session?.citizen?.id ?? null,
          actForCitizenId: actFor?.citizenId ?? null,
          label: lang === 'ur' ? 'نئی درخواست' : 'New application',
        });
        navigate(`/c/apply/${localId}?offline=1`);
      } catch {
        setError(errorMessage(err, lang));
      }
    } finally {
      setBusy(false);
    }
  }, [programs.data, navigate, lang, actFor, session]);

  const tiles: Tile[] = [
    {
      key: 'apply',
      labelKey: 'home.apply',
      audioKey: 'home_apply',
      Icon: IconDocument,
      accent: 'bg-teal-600',
      onClick: () => void startApplication(),
    },
    { key: 'cases', labelKey: 'home.cases', audioKey: 'home_cases', Icon: IconCamera, accent: 'bg-[#1D4ED8]', to: '/c/cases' },
    { key: 'scam', labelKey: 'home.scam', audioKey: 'home_scam', Icon: IconShield, accent: 'bg-[#B4740A]', to: '/scam-check' },
    { key: 'data', labelKey: 'home.data', audioKey: 'home_data', Icon: IconUsers, accent: 'bg-[#6D28D9]', to: '/c/consent' },
  ];

  const greetingName = actFor?.fullName ?? session?.citizen?.full_name ?? session?.user.full_name ?? '';

  return (
    <div className="screen">
      <header className="mb-4 mt-1">
        <p className="text-sm text-ink-soft">{t('home.greeting')}</p>
        <h1 className="text-2xl font-bold text-ink">{greetingName}</h1>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3">
        {tiles.map(({ key, labelKey, audioKey, Icon, accent, to, onClick }) => {
          const content = (
            <>
              <span className={`grid h-16 w-16 place-items-center rounded-2xl text-white ${accent}`}>
                <Icon size={34} />
              </span>
              <span className="mt-3 block text-base font-bold leading-tight text-ink">{t(labelKey)}</span>
              <span className="mt-2 flex items-center gap-1 text-xs font-semibold text-teal-700">
                {t('common.listen')}
                <IconChevron size={12} className="rtl:rotate-180" />
              </span>
            </>
          );

          return (
            <li key={key} className="relative">
              {to ? (
                <button
                  type="button"
                  onClick={() => navigate(to)}
                  className="card flex min-h-[168px] w-full flex-col items-start p-4 text-start transition active:scale-[0.99]"
                >
                  {content}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClick}
                  disabled={busy}
                  className="card flex min-h-[168px] w-full flex-col items-start p-4 text-start transition active:scale-[0.99] disabled:opacity-60"
                >
                  {content}
                </button>
              )}
              <span className="absolute end-3 top-3">
                <AudioButton audioKey={audioKey} text={t(labelKey)} label={`${t('common.listen')}: ${t(labelKey)}`} />
              </span>
            </li>
          );
        })}
      </ul>

      {!lite && (
        <section className="card mt-4 p-4">
          <h2 className="text-sm font-bold text-ink">{t('app.tagline')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {lang === 'ur'
              ? 'آپ بغیر پڑھے، صرف آواز اور تصویروں کی مدد سے درخواست دے سکتی ہیں۔ انٹرنیٹ نہ ہو تو بھی آپ کا کام محفوظ رہتا ہے۔'
              : 'You can apply without reading, using only sound and pictures. Your work is saved even when the internet drops.'}
          </p>
        </section>
      )}
    </div>
  );
}
