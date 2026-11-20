import { useQuery } from '@tanstack/react-query';
import { Lock, Search, UserPlus, Users, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { helper } from '../shared/api/endpoints';
import type { Family } from '../shared/api/types';
import { useAuth } from '../shared/auth/store';
import { useT } from '../shared/i18n';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { cx } from '../shared/ui/cx';
import { PageLoader } from '../shared/ui/Spinner';

export function Avatar({
  family,
  size = 'md',
}: {
  family: Pick<Family, 'full_name' | 'avatar_color'>;
  size?: 'md' | 'xl';
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white',
        size === 'xl' ? 'h-32 w-32 text-5xl' : 'h-14 w-14 text-xl',
      )}
      style={{ backgroundColor: family.avatar_color, textShadow: '0 1px 2px rgb(0 0 0 / 0.35)' }}
    >
      {family.full_name.replace(/^(Mst\.?|Mrs\.?)\s+/i, '').slice(0, 1)}
    </span>
  );
}

/** Helper roster (docs/11 §4.1). Tapping a family = tap 1; "Continue" on the interstitial = tap 2. */
export function FamilyRoster() {
  const { t, lang, pick } = useT();
  const { actingFor, user } = useAuth();
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'locked'>('all');
  const q = useQuery({ queryKey: ['families', user?.id], queryFn: helper.families });

  const list = useMemo(() => {
    const all = (q.data ?? []).filter(
      (f) =>
        filter === 'all' ||
        (filter === 'active' ? f.consent_status === 'ACTIVE' : f.consent_status !== 'ACTIVE'),
    );
    const s = query.trim().toLowerCase();
    return s
      ? all.filter((f) => f.full_name.toLowerCase().includes(s) || (f.full_name_ur ?? '').includes(s))
      : all;
  }, [q.data, query, filter]);

  if (q.isLoading) return <PageLoader label={t('loading')} />;

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">{pick('کمیونٹی کی مدد', 'Community care')}</p>
          <h1 className="text-3xl font-bold tracking-tight">{t('helperTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {pick(
              'ایک وقت میں ایک خاندان۔ محفوظ طریقے سے ساتھ دیں۔',
              'A familiar face. A helping hand. One family at a time.',
            )}
          </p>
        </div>
        <Button asChild size="lg">
          <Link to="/h/new" aria-label={t('addFamily')}>
            <UserPlus className="h-5 w-5" aria-hidden />
            <span className="hidden sm:inline">{t('addFamily')}</span>
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Users className="h-5 w-5 text-primary" aria-hidden />
          <p className="num mt-3 text-3xl font-bold">{q.data?.length ?? 0}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {pick('آپ کے خاندان', 'Families in your care')}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-primary-soft p-5">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
          <p className="num mt-3 text-3xl font-bold text-primary">
            {q.data?.filter((f) => f.consent_status === 'ACTIVE').length ?? 0}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{pick('فعال اجازت', 'With active permission')}</p>
        </div>
      </div>

      {q.isError && (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-soft p-4">
          <p>{pick('خاندانوں کی فہرست نہیں مل سکی۔', 'We could not load your families.')}</p>
          <button type="button" onClick={() => void q.refetch()} className="min-h-12 font-bold text-danger">
            {t('retry')}
          </button>
        </div>
      )}

      <label className="relative block">
        <span className="sr-only">{t('helperSearch')}</span>
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('helperSearch')}
          className="min-h-tap-lg w-full rounded-xl border border-input bg-card ps-11 pe-14 text-base"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={pick('تلاش صاف کریں', 'Clear search')}
            className="absolute end-1 top-1 flex h-12 w-12 items-center justify-center"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </label>

      <div className="flex flex-wrap gap-2" aria-label={pick('خاندان چھانٹیں', 'Filter families')}>
        {(
          [
            { value: 'all', label: pick('تمام خاندان', 'All families') },
            { value: 'active', label: pick('فعال اجازت', 'Active permission') },
            { value: 'locked', label: pick('اجازت درکار', 'Permission needed') },
          ] as const
        ).map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cx(
              'min-h-12 rounded-full border px-4 text-sm font-semibold',
              filter === f.value
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {pick(`${list.length} خاندان دکھائے گئے`, `${list.length} families shown`)}
      </p>

      {list.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-card border-2 border-dashed border-input p-8 text-center">
          <p className="text-lg">{t('noFamilies')}</p>
          {query || filter !== 'all' ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              {pick('تمام خاندان دکھائیں', 'Show all families')}
            </Button>
          ) : (
            <Button asChild size="lg">
              <Link to="/h/new">
                <UserPlus className="h-6 w-6" aria-hidden />
                {t('addFamily')}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {list.map((f) => {
            const locked = f.consent_status !== 'ACTIVE';
            const current = actingFor?.citizenId === f.citizen_id;
            const name = lang === 'ur' && f.full_name_ur ? f.full_name_ur : f.full_name;
            return (
              <li key={f.citizen_id} className="relative">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => nav(`/h/switch/${f.citizen_id}`)}
                  className={cx(
                    'flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-4 pe-20 text-start shadow-card transition-colors duration-fast',
                    current ? 'border-primary' : 'border-border hover:border-primary/60',
                    locked && 'cursor-not-allowed bg-muted',
                  )}
                >
                  <Avatar family={f} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-bold">{name}</span>
                    <span className="num block text-sm text-muted-foreground">
                      {f.cnic_masked ?? '—'} {f.district ? `· ${f.district}` : ''}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-consent-soft px-2 py-0.5 text-xs font-bold text-consent">
                          <Lock className="h-3.5 w-3.5" aria-hidden />
                          {f.consent_status === 'EXPIRED'
                            ? t('consentExpiredRenew')
                            : t('consentWithdrawnLocked')}
                        </span>
                      ) : (
                        f.active_case_count > 0 && (
                          <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-bold text-info">
                            {t('activeCases', { n: f.active_case_count })}
                          </span>
                        )
                      )}
                      {f.assurance_level === 'VERBAL_WITNESSED' && !locked && (
                        <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">
                          {pick('زبانی اجازت', 'Verbal consent')}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <div className="absolute end-3 top-1/2 -translate-y-1/2">
                  <AudioButton size="md" text={name} label={name} className="!h-11 !w-11" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
