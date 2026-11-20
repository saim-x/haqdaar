import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../shared/api/client';
import { MOCK_BASE } from '../../shared/config';
import { Card, CardTitle, ErrorState, Loading, PageHeader } from '../ui';
import { IconRefresh } from '../../shared/ui/Icons';

interface SmsMessage {
  id: string;
  body_ur?: string;
  body_en?: string;
  body?: string;
  verification_code?: string;
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded bg-ink px-2 py-1 text-[10px] font-bold text-white"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * Device Simulator — docs/11 §6.5.
 * Reads the simulated SMS inbox so judges can watch OTPs and official payment
 * messages arrive live, then paste them into the scam checker.
 */
export default function DeviceSimPage() {
  const [phone, setPhone] = useState(PHONES[0]?.phone ?? '');

  const query = useQuery({
    queryKey: ['sms-inbox', phone],
    queryFn: () =>
      request<SmsInbox>(`/sms/inbox/${encodeURIComponent(phone)}`, { base: MOCK_BASE, anonymous: true }).then(
        (res) => res.data,
      ),
    refetchInterval: 5_000,
    enabled: phone.length > 0,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Device simulator"
        subtitle="Simulated SMS inbox — no real telecom gateway is involved."
        actions={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold text-ink-soft hover:bg-ink/5"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {PHONES.map((p) => (
          <button
            key={p.phone}
            type="button"
            onClick={() => setPhone(p.phone)}
            className={`min-h-tap rounded-lg border px-3 text-xs font-semibold ${
              phone === p.phone ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-ink/15 bg-white text-ink-soft'
            }`}
          >
            {p.label}
            <span className="num ms-2 text-[10px] text-ink-soft">{p.phone}</span>
          </button>
        ))}
      </div>

      {query.isLoading && <Loading label="Reading inbox…" />}
      {query.error && <ErrorState error={query.error} />}

      {query.data && (
        <Card>
          <CardTitle hint={`${query.data.messages.length} messages`}>
            Inbox for <span className="num">{phone}</span>
          </CardTitle>
          <ul className="space-y-2">
            {query.data.messages.map((msg) => {
              const code = msg.verification_code ?? msg.code ?? null;
              return (
                <li key={msg.id} className="rounded-lg border border-ink/10 bg-[#F7F7F5] p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase text-ink-soft">SMS</span>
                    <span className="num text-[10px] text-ink-soft">{new Date(msg.created_at).toLocaleString()}</span>
                    {code && (
                      <span className="ms-auto inline-flex items-center gap-1.5">
                        <span className="num rounded bg-teal-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{code}</span>
                        <CopyButton value={code} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-ink" dir="rtl">
                    {msg.body_ur ?? msg.body ?? ''}
                  </p>
                  {msg.body_en && <p className="mt-1 text-[11px] text-ink-soft">{msg.body_en}</p>}
                </li>
              );
            })}
            {query.data.messages.length === 0 && (
              <li className="text-xs text-ink-soft">No messages yet. Trigger an OTP or a payment to see one arrive.</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
