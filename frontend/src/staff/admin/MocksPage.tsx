import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { MocksResponse, MockMode, MockServiceConfig } from '../../shared/api/types';
import { Card, CardTitle, ErrorState, Loading, PageHeader } from '../ui';

const MODES: MockMode[] = ['NORMAL', 'SLOW', 'FLAKY', 'DOWN'];

const MODE_TONE: Record<MockMode, string> = {
  NORMAL: 'bg-[#0F7B3F] text-white',
  SLOW: 'bg-amber-400 text-[#3B2A00]',
  FLAKY: 'bg-[#B4740A] text-white',
  DOWN: 'bg-[#B42318] text-white',
};

/**
 * Mock chaos controls — docs/11 §6.2.4, AC-17.2.
 * Platform admin only. Setting a service to DOWN must produce WAITING_EXTERNAL,
 * never a guess.
 */
export default function MocksPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const query = useQuery({
    queryKey: ['admin-mocks'],
    queryFn: () => api.get<MocksResponse>('/admin/mocks'),
  });

  const update = useMutation({
    mutationFn: ({ service, patch }: { service: string; patch: Partial<MockServiceConfig> }) =>
      api.patch<MockServiceConfig>(`/admin/mocks/${service}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-mocks'] }),
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  const reset = useMutation({
    mutationFn: () => api.post('/admin/demo/reset'),
    onSuccess: () => {
      setMessage('Demo state reset and re-seeded.');
      setConfirmReset(false);
      void queryClient.invalidateQueries();
    },
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mock services"
        subtitle="Simulated DPI rails. Chaos here proves the platform never guesses when a registry is down."
        actions={
          confirmReset ? (
            <>
              <button
                type="button"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                className="min-h-tap rounded-lg bg-[#B42318] px-3 text-xs font-bold text-white"
              >
                Confirm reset
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} className="min-h-tap rounded-lg px-3 text-xs font-semibold text-ink-soft">
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="min-h-tap rounded-lg border border-[#B42318]/40 px-3 text-xs font-bold text-[#B42318] hover:bg-[#B42318]/5"
            >
              Demo reset
            </button>
          )
        }
      />

      {message && <div className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs font-semibold text-ink">{message}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {query.data?.services.map((service) => (
          <Card key={service.service_name}>
            <CardTitle hint={service.service_name}>{service.service_name.replace(/_/g, ' ')}</CardTitle>
            <div className="mb-2 flex flex-wrap gap-1">
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => update.mutate({ service: service.service_name, patch: { mode } })}
                  className={`rounded px-2 py-1 text-[10px] font-bold ${
                    service.mode === mode ? MODE_TONE[mode] : 'bg-ink/5 text-ink-soft'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <label className="block text-[10px] font-bold uppercase text-ink-soft">
              Latency {service.latency_ms}ms
              <input
                type="range"
                min={0}
                max={8000}
                step={100}
                value={service.latency_ms}
                onChange={(e) =>
                  update.mutate({ service: service.service_name, patch: { latency_ms: Number(e.target.value) } })
                }
                className="mt-1 w-full"
              />
            </label>
            <label className="mt-1 block text-[10px] font-bold uppercase text-ink-soft">
              Failure rate {(service.failure_rate * 100).toFixed(0)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={service.failure_rate}
                onChange={(e) =>
                  update.mutate({ service: service.service_name, patch: { failure_rate: Number(e.target.value) } })
                }
                className="mt-1 w-full"
              />
            </label>
          </Card>
        ))}
      </div>
    </div>
  );
}
