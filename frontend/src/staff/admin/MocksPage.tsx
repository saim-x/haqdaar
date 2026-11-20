import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, Gauge, RotateCcw, Shuffle, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { admin } from '../../shared/api/endpoints';
import type { MockMode } from '../../shared/api/types';
import { queryClient } from '../../shared/queryClient';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Modal } from '../../shared/ui/Modal';
import { PageLoader } from '../../shared/ui/Spinner';
import { ErrorState, fmtTime, PageHeader } from '../ui';

const LABEL: Record<string, string> = {
  identity: 'Identity registry (NADRA-like)',
  civil: 'Civil death registry',
  household: 'Household survey',
  benefits: 'Benefits registry',
  payment: 'Instant payments (Raast-like)',
  complaint: 'Complaint registry',
  sms: 'SMS gateway',
};

const MODES: { mode: MockMode; icon: LucideIcon; tone: string; hint: string }[] = [
  { mode: 'NORMAL', icon: Zap, tone: 'border-ok bg-ok-soft text-ok', hint: '30–80 ms' },
  { mode: 'SLOW', icon: Gauge, tone: 'border-warn bg-warn-soft text-warn', hint: '~4 s latency' },
  { mode: 'FLAKY', icon: Shuffle, tone: 'border-warn bg-warn-soft text-warn', hint: '50 % fail' },
  { mode: 'DOWN', icon: CloudOff, tone: 'border-danger bg-danger-soft text-danger', hint: '503 always' },
];

/** Chaos controls for the simulated DPI services (F-17, J-8). Platform admin only. */
export function MocksPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mocks'], queryFn: admin.mocks, refetchInterval: 5000 });
  const set = useMutation({
    mutationFn: (v: { service: string; mode: MockMode }) => admin.updateMock(v.service, { mode: v.mode }),
    onSuccess: (m) => {
      toast(`${LABEL[m.service_name] ?? m.service_name} is now ${m.mode}`);
      void qc.invalidateQueries({ queryKey: ['mocks'] });
    },
  });
  const [resetOpen, setResetOpen] = useState(false);
  const reset = useMutation({
    mutationFn: admin.demoReset,
    onSuccess: () => {
      setResetOpen(false);
      queryClient.clear();
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Platform · simulated services"
        title="Simulated DPI services"
        subtitle="Every external system is a mock behind a real HTTP boundary. Break one to show that the platform waits instead of guessing (WAITING_EXTERNAL), then restore it and watch the worker retry."
        actions={
          <Button size="sm" variant="danger" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => setResetOpen(true)}>
            Demo reset
          </Button>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data!.map((m) => (
            <li key={m.service_name} className={cx('card p-4', m.mode === 'DOWN' && 'border-danger')}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{LABEL[m.service_name] ?? m.service_name}</p>
                  <p className="font-mono text-xs text-muted">/mock/v1/{m.service_name} · simulated</p>
                </div>
                <span className={cx('rounded px-2 py-0.5 text-xs font-bold', MODES.find((x) => x.mode === m.mode)?.tone)}>{m.mode}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`${m.service_name} mode`}>
                {MODES.map(({ mode, icon: Icon, tone, hint }) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={m.mode === mode}
                    title={hint}
                    disabled={set.isPending}
                    onClick={() => set.mutate({ service: m.service_name, mode })}
                    className={cx('flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border-2 text-[11px] font-bold transition-colors duration-fast', m.mode === mode ? tone : 'border-line text-muted hover:border-line-strong')}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {mode}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Changed {fmtTime(m.updated_at)}</p>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset all demo data?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset demo
            </Button>
          </>
        }
      >
        <p>Re-seeds personas, queue cases, historical cases and mock registries, and sets every service back to NORMAL. Only available when DEMO_MODE=true.</p>
        {reset.isSuccess && <p className="mt-2 font-semibold text-ok">Demo data reset.</p>}
        {reset.error && <ErrorState error={reset.error} />}
      </Modal>
    </div>
  );
}
