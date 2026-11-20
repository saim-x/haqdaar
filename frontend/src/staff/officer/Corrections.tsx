import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { officer } from '../../shared/api/endpoints';
import { Button } from '../../shared/ui/Button';
import { PageLoader } from '../../shared/ui/Spinner';
import { EmptyState, ErrorState, fmtTime, PageHeader } from '../ui';

/** Registry-sourced correction requests need an officer; self-declared ones apply instantly (F-12). */
export function Corrections() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['corrections'], queryFn: officer.corrections });
  const resolve = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => officer.resolveCorrection(id, approve, approve ? 'Verified with applicant' : 'Could not verify'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['corrections'] }),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Officer workspace"
        title="Data correction requests"
        subtitle="Citizens can correct their own answers instantly. Values that came from a registry cannot be edited by us, so they come here for review."
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <EmptyState title="No pending corrections" body="When a citizen disputes a registry value, the request lands here with their reason." />
      ) : (
        <div className="card divide-y divide-line">
          {q.data.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {c.citizen_name ?? 'Citizen'} · <span className="font-mono text-sm">{c.field_key}</span>
                </p>
                <p className="text-sm text-muted">
                  Requested <span className="font-mono font-semibold text-ink">{String(c.requested_value)}</span>
                  {c.reason ? `: “${c.reason}”` : ''} · {fmtTime(c.created_at)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="success" icon={<Check className="h-4 w-4" aria-hidden />} loading={resolve.isPending && resolve.variables?.id === c.id && resolve.variables.approve} onClick={() => resolve.mutate({ id: c.id, approve: true })}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" aria-hidden />} onClick={() => resolve.mutate({ id: c.id, approve: false })}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
