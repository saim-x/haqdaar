import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { ApiKeyCreated, ApiKeyRecord } from '../../shared/api/types';
import { CopyCode } from '../../shared/ui/CopyCode';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

const SCOPES = ['cases:read', 'scam:check', 'rules:read'];

/**
 * Admin API keys — docs/11 §6.2.3. The plaintext key is shown exactly once.
 *
 * The reveal is a stamped panel, not a green success banner: this is the one
 * moment where a secret is on screen, so it should look like a document you are
 * being handed, with the copy affordance right next to it.
 */
export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['cases:read']);
  const [rateLimit, setRateLimit] = useState(60);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: () => api.get<{ items: ApiKeyRecord[] }>('/admin/api-keys'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<ApiKeyCreated>('/admin/api-keys', {
        name,
        scopes,
        rate_limit_per_min: rateLimit,
      }),
    onSuccess: (res) => {
      setCreated(res);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] });
    },
    onError: (err) => setError(errorMessage(err, 'en')),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/admin/api-keys/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] }),
    onError: (err) => setError(errorMessage(err, 'en')),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="API keys"
        subtitle="Public REST API access. A revoked key fails on the next call with 401."
      />

      {error && (
        <div
          role="alert"
          className="rounded-control border border-negative/25 bg-negative-wash px-4 py-2.5 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      {created && (
        <Card className="border-accent/30 bg-accent-wash">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-body font-medium text-ink">New API key</h2>
            <span className="stamp">shown once</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="num min-w-0 flex-1 overflow-x-auto rounded-control border border-ink/[0.10] bg-card px-3 py-2 font-mono text-caption text-ink">
              {created.api_key}
            </code>
            <CopyCode value={created.api_key} label="Key" tone="ink" size="md" />
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="press min-h-[36px] rounded-control px-2.5 text-meta text-ink-2 hover:bg-card hover:text-ink"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-meta text-ink-2">
            Copy it now. The server stores only a hash, so this value cannot be shown again.
          </p>
        </Card>
      )}

      <Card>
        <CardTitle>Create key</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Key name"
            aria-label="Key name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field min-w-[200px] flex-1"
          />
          {SCOPES.map((scope) => {
            const on = scopes.includes(scope);
            return (
              <button
                key={scope}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setScopes((prev) => (on ? prev.filter((s) => s !== scope) : [...prev, scope]))
                }
                className={`press inline-flex min-h-[36px] items-center rounded-control border px-2.5 font-mono text-meta ${
                  on
                    ? 'border-accent/40 bg-accent-wash font-medium text-accent-ink'
                    : 'border-ink/[0.12] text-ink-2 hover:bg-raised hover:text-ink'
                }`}
              >
                {scope}
              </button>
            );
          })}
          <input
            type="number"
            min={5}
            max={600}
            value={rateLimit}
            onChange={(e) => setRateLimit(Math.max(5, Number(e.target.value) || 60))}
            aria-label="Rate limit per minute"
            title="Requests per minute"
            className="field num w-24 font-mono"
          />
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !name || scopes.length === 0}
            className="press min-h-[36px] rounded-control bg-accent px-4 text-caption font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            Create
          </button>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="ledger min-w-[720px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th className="text-end">Rate</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((key) => (
              <tr key={key.id} className={key.is_active ? undefined : 'opacity-60'}>
                <td className="font-medium text-ink">{key.name}</td>
                <td className="font-mono text-meta text-ink-2">{key.key_prefix}…</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                  </div>
                </td>
                <td className="num text-end font-mono text-meta text-ink-2">
                  {key.rate_limit_per_min}/min
                </td>
                <td className="num text-meta text-ink-3">
                  {key.last_used_at
                    ? new Date(key.last_used_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Never'}
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`live-dot ${key.is_active ? 'bg-positive' : 'bg-ink-3'}`}
                      aria-hidden
                    />
                    <span className="text-meta text-ink-2">
                      {key.is_active ? 'active' : 'revoked'}
                    </span>
                  </span>
                </td>
                <td className="text-end">
                  {key.is_active && (
                    <button
                      type="button"
                      onClick={() => revoke.mutate(key.id)}
                      className="press min-h-[30px] rounded-[7px] border border-negative/30 px-2 text-meta text-negative hover:bg-negative-wash"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {query.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-caption text-ink-3">
                  No keys issued yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
