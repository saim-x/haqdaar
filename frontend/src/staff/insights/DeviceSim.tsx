import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, MessageSquareText, Signal, Wifi } from 'lucide-react';
import { useState } from 'react';
import { insights } from '../../shared/api/endpoints';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { ErrorState, fmtTime, PageHeader } from '../ui';

const PHONES = [
  { phone: '+923001000001', name: 'Fatima Bibi' },
  { phone: '+923001000002', name: 'Rasool Bakhsh' },
  { phone: '+923001000003', name: 'Ayesha (shared phone)' },
];

/** Simulated phone inbox so judges can watch OTPs and official payment SMS arrive (F-29). */
export function DeviceSim() {
  const [phone, setPhone] = useState(PHONES[0].phone);
  const [copied, setCopied] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['sms', phone], queryFn: () => insights.smsInbox(phone), refetchInterval: 3000 });
  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <PageHeader eyebrow="Demo support · simulated SMS" title="Device simulator" subtitle="No telecom gateway is used. Copy an official message into the scam checker to verify its HQ- code, or edit one digit to see it caught." />
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,420px)]">
        <div className="space-y-2">
          {PHONES.map((p) => (
            <button
              key={p.phone}
              type="button"
              onClick={() => setPhone(p.phone)}
              aria-pressed={phone === p.phone}
              className={cx('w-full rounded-lg border p-3 text-start', phone === p.phone ? 'border-primary bg-primary-soft' : 'border-border bg-card hover:border-input')}
            >
              <p className="font-semibold">{p.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{p.phone}</p>
            </button>
          ))}
        </div>

        <div className="mx-auto w-full max-w-[400px] rounded-[2.5rem] border-[10px] border-foreground bg-foreground p-1 shadow-lift">
          <div className="overflow-hidden rounded-[1.9rem] bg-background">
            <div className="flex items-center justify-between bg-card px-5 py-2 text-xs font-semibold">
              <span>{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="flex items-center gap-1">
                <Signal className="h-3.5 w-3.5" aria-hidden />
                <Wifi className="h-3.5 w-3.5" aria-hidden />
              </span>
            </div>
            <div className="border-b border-border bg-card px-4 py-3">
              <p className="flex items-center gap-2 font-bold">
                <MessageSquareText className="h-4 w-4" aria-hidden />
                Messages · {PHONES.find((p) => p.phone === phone)?.name}
              </p>
              <p className="text-[11px] text-muted-foreground">Simulated inbox · /mock/v1/sms/inbox</p>
            </div>
            <div className="h-[520px] space-y-3 overflow-y-auto p-3" aria-live="polite">
              {q.isLoading ? (
                <PageLoader />
              ) : q.error ? (
                <ErrorState error={q.error} />
              ) : !q.data?.messages.length ? (
                <p className="pt-20 text-center text-sm text-muted-foreground">No messages yet. Request an OTP or approve a case to see one arrive.</p>
              ) : (
                q.data.messages.map((m) => (
                  <article key={m.id} className="rounded-2xl rounded-tl-sm bg-card p-3 shadow-card">
                    <p className="mb-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {m.kind === 'OTP' && <KeyRound className="h-3 w-3" aria-hidden />}
                        HAQDAAR {m.kind === 'OTP' ? '· OTP' : ''}
                      </span>
                      <span>{fmtTime(m.created_at)}</span>
                    </p>
                    <p className="text-sm">{m.body_en}</p>
                    <p className="mt-1 font-urdu text-sm text-muted-foreground" lang="ur" dir="rtl">
                      {m.body_ur}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => copy(m.body_en, m.id)} className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-border px-2.5 text-xs font-semibold hover:bg-muted">
                        <Copy className="h-3 w-3" aria-hidden />
                        {copied === m.id ? 'Copied' : 'Copy message'}
                      </button>
                      {m.verification_code && (
                        <button type="button" onClick={() => copy(m.verification_code!, `${m.id}-c`)} className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-primary-soft px-2.5 font-mono text-xs font-bold text-primary">
                          {copied === `${m.id}-c` ? 'Copied' : m.verification_code}
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
