import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { ApiKeyCreated, ApiKeyRecord } from '../../shared/api/types';
import { CopyCode } from '../../shared/ui/CopyCode';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

const SCOPES = ['cases:read', 'scam:check', 'rules:read'];

/** Admin API keys — docs/11 §6.2.3. The plaintext key is shown exactly once. */
export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['cases:read']);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: () => api.get<{ items: ApiKeyRecord[] }>('/admin/api-keys'),
  });

  const create = useMutation({
    mutationFn: () => api.post<ApiKeyCreated>('/admin/api-keys', { name, scopes }),
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
      <PageHeader title="API keys" subtitle="Public REST API access. A revoked key fails on the next call with 401." />

      {error && <div className="rounded-lg border-2 border-[#B42318]/30 bg-[#B42318]/5 px-3 py-2 text-xs font-semibold text-[#B42318]">{error}</div>}

      {created && (
        <Card className="border-2 border-teal-600/40 bg-teal-50">
          <CardTitle hint="shown once — copy it now">New API key</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <code className="num min-w-0 flex-1 overflow-x-auto rounded bg-white px-2 py-1.5 font-mono text-xs">{created.api_key}</code>
            <CopyCode value={created.api_key} label="Key" tone="ink" size="md" />
            <button type="button" onClick={() => setCreated(null)} className="rounded px-2 py-1.5 text-[11px] font-semibold text-ink-soft">
              Dismiss
            </button>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Create key</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Key name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-tap min-w-[180px] flex-1 rounded-lg border border-ink/15 px-2 text-xs"
          />
          {SCOPES.map((scope) => (
            <label key={scope} className="inline-flex min-h-tap items-center gap-1 rounded-lg border border-ink/15 px-2 text-[11px] font-semibold text-ink-soft">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes((prev) => (e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope)))
                }
              />
              {scope}
            </label>
          ))}
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !name || scopes.length === 0}
            className="min-h-tap rounded-lg bg-teal-700 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Prefix</th>
              <th className="px-3 py-2">Scopes</th>
              <th className="px-3 py-2">Rate</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((key) => (
              <tr key={key.id} className="border-b border-ink/5 last:border-0">
                <td className="px-3 py-2 font-semibold text-ink">{key.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-soft">{key.key_prefix}…</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                  </div>
                </td>
                <td className="num px-3 py-2 text-xs text-ink-soft">{key.rate_limit_per_min}/min</td>
                <td className="px-3 py-2">
                  <Chip tone={key.is_active ? 'ok' : 'neutral'}>{key.is_active ? 'active' : 'revoked'}</Chip>
                </td>
                <td className="px-3 py-2 text-right">
                  {key.is_active && (
                    <button
                      type="button"
                      onClick={() => revoke.mutate(key.id)}
                      className="rounded border border-[#B42318]/30 px-2 py-1 text-[11px] font-semibold text-[#B42318] hover:bg-[#B42318]/5"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
