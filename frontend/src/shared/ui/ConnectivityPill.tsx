import { CircleAlert, RefreshCw, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import type { OutboxRow } from '../offline/db';
import { discard, retryFailed, useOnline, useOutbox, useSyncing } from '../offline/outbox';
import { Button } from './Button';
import { cx } from './cx';
import { Modal } from './Modal';

type ConnState = 'online' | 'offline' | 'syncing' | 'attention';

function useConnectivity(): { state: ConnState; label: string; icon: LucideIcon; tone: string; pending: number; failed: OutboxRow[] } {
  const { t } = useT();
  const online = useOnline();
  const syncing = useSyncing();
  const { pending, failed } = useOutbox();
  if (failed.length) return { state: 'attention', label: t('needsAttention', { n: failed.length }), icon: CircleAlert, tone: 'bg-danger-soft text-danger border-danger/30', pending, failed };
  if (!online) return { state: 'offline', label: pending ? t('offlineSaved', { n: pending }) : t('offlineNone'), icon: WifiOff, tone: 'bg-warn-soft text-warn border-warn/30', pending, failed };
  if (syncing || pending) return { state: 'syncing', label: t('syncing'), icon: RefreshCw, tone: 'bg-info-soft text-info border-info/30', pending, failed };
  return { state: 'online', label: t('online'), icon: Wifi, tone: 'bg-ok-soft text-ok border-ok/30', pending, failed };
}

function OutboxModal({ open, onClose, label, pending, failed }: { open: boolean; onClose: () => void; label: string; pending: number; failed: OutboxRow[] }) {
  const { t, pick } = useT();
  const online = useOnline();
  return (
    <Modal open={open} onClose={onClose} title={label} closeLabel={t('close')}>
      {failed.length === 0 && <p className="text-muted-foreground">{pending ? t('offlineSaved', { n: pending }) : t('online')}</p>}
      <ul className="space-y-3">
        {failed.map((f) => (
          <li key={f.id} className="rounded-control border border-danger/40 bg-danger-soft p-3">
            <p className="font-medium text-danger">{pick(f.lastErrorUr, f.lastError) || t('somethingWrong')}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void retryFailed(f.id)}>
                {t('retry')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void discard(f.id)}>
                {t('cancel')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {online && pending > 0 && (
        <Button className="mt-4" variant="secondary" onClick={() => void retryFailed()} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
          {t('retry')}
        </Button>
      )}
    </Modal>
  );
}

/** Compact header indicator: just an icon while everything is synced. */
export function ConnectivityIcon() {
  const c = useConnectivity();
  if (c.state !== 'online') return null;
  return (
    <span role="status" title={c.label} className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border', c.tone)}>
      <c.icon className="h-4 w-4" aria-hidden />
      <span className="sr-only">{c.label}</span>
    </span>
  );
}

/** Full-width strip under the header when offline / syncing / needing attention (docs/11 §5.3). */
export function ConnectivityStrip() {
  const c = useConnectivity();
  const [open, setOpen] = useState(false);
  if (c.state === 'online') return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-live="polite"
        className={cx('flex min-h-[40px] w-full items-center justify-center gap-2 border-t px-3 text-sm font-semibold', c.tone)}
      >
        <c.icon className={cx('h-4 w-4 shrink-0', c.state === 'syncing' && 'animate-spin-slow')} aria-hidden />
        <span className="min-w-0 truncate">{c.label}</span>
      </button>
      <OutboxModal open={open} onClose={() => setOpen(false)} label={c.label} pending={c.pending} failed={c.failed} />
    </>
  );
}
