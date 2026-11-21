import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../shared/api/client';
import { MOCK_BASE } from '../../shared/config';
import { smsCodes } from '../../shared/lib/codes';
import { CopyCode } from '../../shared/ui/CopyCode';
import { Card, ErrorState, Loading, PageHeader } from '../ui';
import { IconRefresh } from '../../shared/ui/Icons';

interface SmsMessage {
  id: string;
  kind?: string;
  title_ur?: string;
  title_en?: string;
  body_ur?: string;
  body_en?: string;
  body?: string;
  verification_code?: string;
  body_sha256?: string;
  code?: string;
  created_at: string;
}

interface SmsInbox {
  simulated: boolean;
  service: string;
  messages: SmsMessage[];
}

const PHONES = [
  { label: 'Fatima Bibi (widow)', phone: '+923001000001' },
  { label: 'Rasool Bakhsh (shopkeeper)', phone: '+923001000002' },
  { label: 'Ayesha Khatoon (helper)', phone: '+923001000003' },
];

/**
 * Device Simulator — docs/11 §6.5.
 * Reads the simulated SMS inbox so judges can watch OTPs and official payment
 * messages arrive live, then paste them into the scam checker or the helper's
 * consent form. Every code is one tap from the clipboard.
 *
 * The inbox is drawn as a phone would draw it: one message per ruled block, the
 * Urdu body at reading size, the code as a figure you can copy. Nothing here is
 * a badge — a judge is reading these out loud.
 */
export default function DeviceSimPage() {
  const [phone, setPhone] = useState(PHONES[0]?.phone ?? '');
  const [customPhone, setCustomPhone] = useState('');

  const query = useQuery({
    queryKey: ['sms-inbox', phone],
    queryFn: () =>
      request<SmsInbox>(`/sms/inbox/${encodeURIComponent(phone)}`, {
        base: MOCK_BASE,
        anonymous: true,
      }).then((res) => res.data),
    refetchInterval: 5_000,
    enabled: phone.length > 0,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Device simulator"
        subtitle="Simulated SMS inbox — no real telecom gateway is involved. Tap any code to copy it."
        actions={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink-2 hover:bg-raised hover:text-ink"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {PHONES.map((p) => {
          const selected = phone === p.phone;
          return (
            <button
              key={p.phone}
              type="button"
              onClick={() => setPhone(p.phone)}
              className={`press min-h-[36px] rounded-control border px-3 text-caption ${
                selected
                  ? 'border-accent/40 bg-accent-wash font-medium text-accent-ink'
                  : 'border-ink/[0.12] bg-card text-ink-2 hover:bg-raised hover:text-ink'
              }`}
            >
              {p.label}
              <span className="num ms-2 font-mono text-meta text-ink-3">{p.phone}</span>
            </button>
          );
        })}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (customPhone.trim()) setPhone(customPhone.trim());
          }}
        >
          <input
            value={customPhone}
            onChange={(e) => setCustomPhone(e.target.value)}
            placeholder="+92300..."
            aria-label="Custom synthetic phone"
            className="field num w-40 font-mono"
          />
          <button
            type="submit"
            disabled={!customPhone.trim()}
            className="press min-h-[36px] rounded-control border border-ink/[0.14] bg-card px-2.5 text-meta font-medium text-ink-2 hover:bg-raised disabled:opacity-45"
          >
            Open
          </button>
        </form>
      </div>

      {query.isLoading && <Loading label="Reading inbox…" />}
      {query.error && <ErrorState error={query.error} />}

      {query.data && (
        <Card className="p-0">
          <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
            <h2 className="text-body font-medium text-ink">
              Inbox for <span className="num font-mono">{phone}</span>
            </h2>
            <p className="num text-meta text-ink-3">{query.data.messages.length} messages</p>
          </div>

          <ul>
            {query.data.messages.map((msg) => {
              const { otp, hq } = smsCodes(msg);
              return (
                <li key={msg.id} className="border-b border-ink/[0.06] px-4 py-3 last:border-b-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-meta text-ink-3">{msg.kind ?? 'SMS'}</span>
                    <span className="num text-meta text-ink-3">
                      {new Date(msg.created_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="ms-auto flex flex-wrap items-center gap-1.5">
                      {otp && <CopyCode value={otp} label="OTP" tone="teal" />}
                      {hq && <CopyCode value={hq} label="HQ code" tone="ink" />}
                    </span>
                  </div>

                  {msg.title_ur && (
                    <p className="text-caption font-medium text-ink" dir="rtl" lang="ur">
                      {msg.title_ur}
                    </p>
                  )}
                  <p className="max-w-[62ch] text-body leading-[1.8] text-ink" dir="rtl" lang="ur">
                    {msg.body_ur ?? msg.body ?? ''}
                  </p>
                  {msg.body_en && (
                    <p className="mt-1.5 max-w-[62ch] text-meta leading-[1.7] text-ink-2">
                      {msg.body_en}
                    </p>
                  )}
                  {msg.body_sha256 && (
                    <p className="mt-1.5 font-mono text-[11px] text-ink-3">
                      body_sha256: <span className="text-ink-2">{msg.body_sha256.slice(0, 20)}…</span>
                    </p>
                  )}
                </li>
              );
            })}
            {query.data.messages.length === 0 && (
              <li className="px-4 py-6 text-center text-caption text-ink-3">
                No messages yet. Trigger an OTP or a payment to see one arrive.
              </li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
