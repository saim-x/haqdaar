import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { helper } from '../shared/api/endpoints';
import { play } from '../shared/audio';
import { switchFamily } from '../shared/auth/session';
import { useAuth } from '../shared/auth/store';
import { useT } from '../shared/i18n';
import { Button } from '../shared/ui/Button';
import { PageLoader } from '../shared/ui/Spinner';
import { Avatar } from './FamilyRoster';

/**
 * Full-screen confirmation after a family switch (docs/11 §4.3). The previous
 * family's cached data is wiped synchronously before this renders, and the
 * helper has to see the new name and face before continuing.
 */
export function SwitchInterstitial() {
  const { citizenId } = useParams();
  const { t, lang } = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  const switched = useRef(false);
  // The family list survives the wipe because we re-read it after switching.
  const q = useQuery({ queryKey: ['families', user?.id], queryFn: helper.families });
  const family = q.data?.find((f) => f.citizen_id === citizenId);

  useEffect(() => {
    if (!family || switched.current) return;
    switched.current = true;
    switchFamily(family);
    const name = lang === 'ur' && family.full_name_ur ? family.full_name_ur : family.full_name;
    void play({ text: t('nowHelping', { name }), lang, clip: undefined });
  }, [family, lang, t]);

  if (q.isLoading || (!family && !q.isFetched)) return <PageLoader />;
  if (!family || family.consent_status !== 'ACTIVE') return <Navigate to="/h" replace />;

  const name = lang === 'ur' && family.full_name_ur ? family.full_name_ur : family.full_name;
  const Icon = lang === 'ur' ? ArrowLeft : ArrowRight;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-background p-6 text-center animate-rise" role="alertdialog" aria-labelledby="switch-title">
      <Avatar family={family} size="xl" />
      <h1 id="switch-title" className="max-w-sm text-3xl font-bold leading-snug">
        {t('nowHelping', { name })}
      </h1>
      <p className="num text-lg text-muted-foreground">{family.cnic_masked}</p>
      <Button size="xl" className="min-w-[240px]" onClick={() => nav('/c', { replace: true })} autoFocus>
        {t('continue')}
        <Icon className="h-7 w-7" aria-hidden />
      </Button>
      <button type="button" className="min-h-tap px-4 font-semibold text-muted-foreground underline" onClick={() => nav('/h', { replace: true })}>
        {t('switchFamily')}
      </button>
    </div>
  );
}
