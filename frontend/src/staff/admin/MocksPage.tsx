import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import { useDemoMode } from '../../shared/auth/useDemoMode';
import type { MocksResponse, MockMode, MockServiceConfig } from '../../shared/api/types';
import { Card, ErrorState, Loading, mockModeWord, PageHeader } from '../ui';

const MODES: MockMode[] = ['NORMAL', 'SLOW', 'FLAKY', 'DOWN'];

/** Acronyms the generic title-caser would mangle. */
const SERVICE_LABEL: Record<string, string> = {
  sms: 'SMS',
  raast: 'Raast',
  identity: 'Identity',
  civil_registry: 'Civil Registry',
  household_survey: 'Household Survey',
  benefits: 'Benefits',
  complaints: 'Complaints',
};

const serviceWord = (name: string) =>
  SERVICE_LABEL[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');

const MODE_TONE: Record<MockMode, { dot: string; text: string; on: string }> = {
  NORMAL: { dot: 'bg-positive', text: 'text-positive', on: 'border-positive/40 bg-positive-wash text-positive' },
  SLOW: { dot: 'bg-warn', text: 'text-warn', on: 'border-warn/40 bg-warn-wash text-warn' },
  FLAKY: { dot: 'bg-warn', text: 'text-warn', on: 'border-warn/40 bg-warn-wash text-warn' },
  DOWN: { dot: 'bg-negative', text: 'text-negative', on: 'border-negative/40 bg-negative-wash text-negative' },
};

/**
 * Mock chaos controls — docs/11 §6.2.4, AC-17.2.
 * Platform admin only. Setting a service to DOWN must produce WAITING_EXTERNAL,
 * never a guess.
 *
 * Each service is a small instrument panel: the current mode is a dot and a
 * word, the four modes are a segmented row, and the two dials are native range
 * inputs with the value printed in tabular figures beside the label.
 */
export default function MocksPage() {
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
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
          !demoMode.data ? null : confirmReset ? (
            <>
              <button
                type="button"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                className="press min-h-[36px] rounded-control bg-negative px-3 text-caption font-medium text-white hover:bg-negative-ink disabled:opacity-50"
              >
                Confirm reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="press min-h-[36px] rounded-control px-3 text-caption text-ink-2 hover:bg-raised hover:text-ink"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="press min-h-[36px] rounded-control border border-negative/30 px-3 text-caption text-negative hover:bg-negative-wash"
            >
              Demo reset
            </button>
          )
        }
      />

      {message && (
        <div className="rounded-control border border-ink/[0.12] bg-card px-4 py-2.5 text-caption text-ink">
          {message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {query.data?.services.map((service) => {
          const tone = MODE_TONE[service.mode];
          return (
            <Card key={service.service_name}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-body font-medium text-ink">
                  {serviceWord(service.service_name)}
                </h2>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`live-dot ${tone.dot}`} aria-hidden />
                  <span className={`text-meta ${tone.text}`}>{mockModeWord(service.mode)}</span>
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {MODES.map((mode) => {
                  const selected = service.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        update.mutate({ service: service.service_name, patch: { mode } })
                      }
                      aria-pressed={selected}
                      className={`press min-h-[30px] rounded-[7px] border text-meta ${
                        selected
                          ? `${MODE_TONE[mode].on} font-medium`
                          : 'border-ink/[0.12] text-ink-2 hover:bg-raised hover:text-ink'
                      }`}
                    >
                      {mockModeWord(mode)}
                    </button>
                  );
                })}
              </div>

              <label className="mt-4 block">
                <span className="flex items-baseline justify-between text-meta text-ink-3">
                  Latency
                  <span className="num font-mono text-ink-2">{service.latency_ms}ms</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={8000}
                  step={100}
                  value={service.latency_ms}
                  onChange={(e) =>
                    update.mutate({
                      service: service.service_name,
                      patch: { latency_ms: Number(e.target.value) },
                    })
                  }
                  className="mt-1.5 w-full accent-accent"
                />
              </label>

              <label className="mt-2 block">
                <span className="flex items-baseline justify-between text-meta text-ink-3">
                  Failure rate
                  <span className="num font-mono text-ink-2">
                    {(service.failure_rate * 100).toFixed(0)}%
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={service.failure_rate}
                  onChange={(e) =>
                    update.mutate({
                      service: service.service_name,
                      patch: { failure_rate: Number(e.target.value) },
                    })
                  }
                  className="mt-1.5 w-full accent-accent"
                />
              </label>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
