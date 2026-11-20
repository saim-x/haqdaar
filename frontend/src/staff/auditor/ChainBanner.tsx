import { useMutation } from '@tanstack/react-query';
import { Link2, Link2Off, ShieldCheck } from 'lucide-react';
import { auditor } from '../../shared/api/endpoints';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';

/** "Verify hash chain" — recomputes SHA-256 over every audit event server-side (AC-18.3). */
export function ChainBanner() {
  const v = useMutation({ mutationFn: auditor.verifyChain });
  const r = v.data;
  return (
    <div
      className={cx(
        'mb-5 flex flex-wrap items-center gap-4 rounded-card border-2 p-4',
        !r ? 'border-line bg-surface' : r.valid ? 'border-ok bg-ok-soft' : 'border-danger bg-danger-soft',
      )}
      aria-live="polite"
    >
      <span className={cx('inline-flex h-12 w-12 items-center justify-center rounded-xl', !r ? 'bg-sunken text-muted' : r.valid ? 'bg-ok text-white' : 'bg-danger text-white')}>
        {!r ? <ShieldCheck className="h-6 w-6" aria-hidden /> : r.valid ? <Link2 className="h-6 w-6" aria-hidden /> : <Link2Off className="h-6 w-6" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        {!r ? (
          <>
            <p className="font-bold">Tamper-evident audit log</p>
            <p className="text-sm text-muted">Each event stores SHA-256(prev_hash | seq | time | action | resource | payload). Editing any row breaks every hash after it.</p>
          </>
        ) : r.valid ? (
          <>
            <p className="text-lg font-bold text-ok">Chain intact: {r.checked_count.toLocaleString()} events verified</p>
            <p className="text-sm text-muted">Recomputed on the server just now.</p>
          </>
        ) : (
          <>
            <p className="text-lg font-bold text-danger">Chain broken at event #{r.first_broken_seq}</p>
            <p className="text-sm text-muted">{r.checked_count} events checked. Every event from #{r.first_broken_seq} onward is untrusted.</p>
          </>
        )}
      </div>
      <Button onClick={() => v.mutate()} loading={v.isPending} variant={r?.valid ? 'secondary' : 'primary'}>
        Verify hash chain
      </Button>
    </div>
  );
}
