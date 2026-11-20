import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, KeyRound, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { admin } from '../../shared/api/endpoints';
import type { ApiKeyCreated } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Modal } from '../../shared/ui/Modal';
import { PageLoader } from '../../shared/ui/Spinner';
import { EmptyState, ErrorState, Field, fmtTime, inputCls, PageHeader } from '../ui';

const SCOPES = ['cases:read', 'rules:read', 'scam:check'];

export function ApiKeysPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: admin.apiKeys });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['cases:read']);
  const [limit, setLimit] = useState(60);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const inv = () => void qc.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: () => admin.createApiKey({ name, scopes, rate_limit_per_min: limit }),
    onSuccess: (k) => {
      setCreated(k);
      setName('');
      inv();
    },
  });
  const revoke = useMutation({ mutationFn: admin.revokeApiKey, onSuccess: inv });

  return (
    <div>
      <PageHeader
        eyebrow="Administration · Public REST API"
        title="API keys"
        subtitle="Partner systems call /api/v1/public/* with an X-API-Key header. Keys are stored hashed; the secret is shown exactly once."
        actions={
          <>
            <a href="/api/docs" target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-semibold hover:bg-muted">
              <ExternalLink className="h-4 w-4" aria-hidden />
              Swagger docs
            </a>
            <Button size="sm" icon={<KeyRound className="h-4 w-4" aria-hidden />} onClick={() => { setCreated(null); setOpen(true); }}>
              Create key
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <EmptyState title="No API keys yet" body="Create a key to let a district dashboard read case status without personal data." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">API keys</caption>
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Prefix</th>
                <th className="px-3 py-2">Scopes</th>
                <th className="px-3 py-2">Limit</th>
                <th className="px-3 py-2">Last used</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.map((k) => (
                <tr key={k.id} className={cx(!k.is_active && 'opacity-60')}>
                  <td className="px-3 py-2 font-semibold">{k.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{k.key_prefix}…</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{k.rate_limit_per_min}/min</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtTime(k.last_used_at)}</td>
                  <td className="px-3 py-2">
                    <span className={cx('rounded px-1.5 py-0.5 text-xs font-bold', k.is_active ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>{k.is_active ? 'Active' : 'Revoked'}</span>
                  </td>
                  <td className="px-3 py-2 text-end">
                    {k.is_active && (
                      <Button size="sm" variant="danger" loading={revoke.isPending && revoke.variables === k.id} onClick={() => revoke.mutate(k.id)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={created ? 'Copy your key now' : 'Create API key'}
        footer={
          created ? (
            <Button onClick={() => setOpen(false)}>I have stored it</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={create.isPending} disabled={!name.trim() || !scopes.length} onClick={() => create.mutate()}>
                Create
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm font-semibold text-warn">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              This is the only time the full key is shown. Only its hash is stored.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-muted p-3 font-mono text-sm">{created.api_key}</code>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="h-4 w-4" aria-hidden />}
                onClick={() => {
                  void navigator.clipboard?.writeText(created.api_key);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. District helpline integration" />
            </Field>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Scopes</legend>
              {SCOPES.map((s) => (
                <label key={s} className="flex min-h-[32px] items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />
                  <span className="font-mono">{s}</span>
                </label>
              ))}
            </fieldset>
            <Field label="Rate limit per minute">
              <input type="number" min={1} max={600} className={inputCls} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </Field>
            {create.error && <ErrorState error={create.error} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
