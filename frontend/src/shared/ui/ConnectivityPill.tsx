import { CircleAlert, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { discard, retryFailed, useOnline, useOutbox, useSyncing } from '../offline/outbox';
import { Button } from './Button';
import { cx } from './cx';
import { Modal } from './Modal';

/** Online / offline (N saved) / syncing / needs-attention pill (docs/11 §5.3). */
export function ConnectivityPill() {
  const { t, pick } = useT();
  const online = useOnline();
  const syncing = useSyncing();
  const { pending, failed } = useOutbox();
  const [open, setOpen] = useState(false);

  let tone = 'bg-ok-soft text-ok';
  let Icon = Wifi;
  let label = t('online');
  if (failed.length) {
    tone = 'bg-danger-soft text-danger';
    Icon = CircleAlert;
    label = t('needsAttention', { n: failed.length });
  } else if (!online) {
    tone = 'bg-warn-soft text-warn';
    Icon = WifiOff;
    label = pending ? t('offlineSaved', { n: pending }) : t('offlineNone');
  } else if (syncing || pending) {
    tone = 'bg-info-soft text-info';
    Icon = RefreshCw;
    label = t('syncing');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (failed.length || pending ? setOpen(true) : undefined)}
        aria-live="polite"
        className={cx('inline-flex min-h-[32px] max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-semibold', tone)}
      >
        <Icon className={cx('h-4 w-4 shrink-0', (syncing || (online && pending > 0)) && !failed.length && 'animate-spin-slow')} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} closeLabel={t('close')}>
        {failed.length === 0 && <p className="text-muted">{pending ? t('offlineSaved', { n: pending }) : t('online')}</p>}
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
    </>
  );
}
