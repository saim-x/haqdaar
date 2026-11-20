import { useQuery } from '@tanstack/react-query';
import { Cpu, Database, FlaskConical, ShieldCheck } from 'lucide-react';
import { insights } from '../shared/api/endpoints';
import type { MockMode, TransparencyItem } from '../shared/api/types';
import { cx } from '../shared/ui/cx';

// Fallback copy of docs/15 §1 so the page is never empty, even when the API is down.
const STATIC_ITEMS: TransparencyItem[] = [
  { component: 'Auth, JWT, RBAC, multi-tenancy, consent engine, audit hash chain', kind: 'REAL', details: 'Enforced server-side in FastAPI + PostgreSQL 16.' },
  { component: 'Versioned rules engine, tri-state evaluator, entity resolution, confidence router, Digital Twin', kind: 'REAL', details: 'Pure deterministic Python engine evaluating live DB rules.' },
  { component: 'Offline-first PWA & idempotent outbox', kind: 'REAL', details: 'Service worker + IndexedDB + server-side Idempotency-Key deduplication.' },
  { component: 'Scam classifier & official verification codes', kind: 'REAL', details: 'Rules + calibrated scikit-learn model (trained on synthetic data) + SMS body hash lookup.' },
  { component: 'Document verification (blur, signed QR, OCR cross-check)', kind: 'REAL', details: 'OpenCV + HMAC-SHA256 signed QR on mock specimen cards.' },
  { component: 'Urdu voice STT/TTS & policy Q&A', kind: 'REAL', details: 'OpenAI whisper / gpt-4o-mini / embeddings with a deterministic fallback.' },
  { component: 'Identity registry (NADRA-like)', kind: 'SIMULATED', details: 'Mock REST API with synthetic 99900-* CNICs and chaos modes.' },
  { component: 'Civil death, household survey & benefits registries', kind: 'SIMULATED', details: 'Mock REST APIs with synthetic data.' },
  { component: 'Instant payments (Raast-like) & complaints', kind: 'SIMULATED', details: 'Mock REST API with idempotent transfers and a test failure alias.' },
  { component: 'SMS / OTP delivery', kind: 'SIMULATED', details: 'Stored and shown in the Device Simulator; no telecom gateway.' },
  { component: 'Citizens, cases & documents', kind: 'SYNTHETIC', details: '100 % fictional personas and watermarked MOCK SPECIMEN cards. Zero real personal data.' },
];

const KIND = {
  REAL: { label: 'Real', cls: 'bg-ok-soft text-ok', icon: Cpu },
  SIMULATED: { label: 'Simulated', cls: 'bg-warn-soft text-warn', icon: FlaskConical },
  SYNTHETIC: { label: 'Synthetic data', cls: 'bg-consent-soft text-consent', icon: Database },
} as const;

const MODE_CLS: Record<MockMode, string> = {
  NORMAL: 'bg-ok-soft text-ok',
  SLOW: 'bg-warn-soft text-warn',
  FLAKY: 'bg-warn-soft text-warn',
  DOWN: 'bg-danger-soft text-danger',
};

/** /transparency — what is real vs simulated (RULE-6, AC-25.2). English, for judges. */
export function TransparencyPage() {
  const q = useQuery({ queryKey: ['transparency'], queryFn: insights.transparency, retry: 0 });
  const items = q.data?.items?.length ? q.data.items : STATIC_ITEMS;

  return (
    <div lang="en" dir="ltr" className="space-y-6 font-sans animate-rise" style={{ lineHeight: 1.5 }}>
      <div>
        <p className="text-sm font-bold uppercase tracking-wider text-highlight">Prototype disclosure</p>
        <h1 className="mt-1 text-4xl font-bold leading-tight">What is real, what is simulated</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Haqdaar is a hackathon prototype. It is <strong className="text-foreground">not an official government service</strong>. No real
          personal data is used anywhere.
        </p>
      </div>

      <ul className="space-y-2">
        {items.map((it) => {
          const k = KIND[it.kind];
          return (
            <li key={it.component} className="card flex items-start gap-3 p-4">
              <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold', k.cls)}>
                <k.icon className="h-3.5 w-3.5" aria-hidden />
                {k.label}
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{it.component}</p>
                <p className="text-sm text-muted-foreground">{it.details}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {q.data?.mock_services && q.data.mock_services.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl font-bold">Simulated services right now</h2>
          <div className="flex flex-wrap gap-2">
            {q.data.mock_services.map((m) => (
              <span key={m.service_name} className={cx('rounded-full px-3 py-1 text-sm font-semibold', MODE_CLS[m.mode])}>
                {m.service_name}: {m.mode}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-card border-2 border-ok/30 bg-ok-soft p-4">
        <h2 className="flex items-center gap-2 font-bold text-ok">
          <ShieldCheck className="h-5 w-5" aria-hidden />
          Synthetic data guarantee
        </h2>
        <p className="mt-1">
          Every CNIC starts with the fictional prefix <code className="font-mono">99900</code>. Every generated document carries a
          visible <strong>MOCK SPECIMEN</strong> watermark. Evaluation numbers come from synthetic benchmarks with independently
          injected noise; in production the same sweep would run on officer-audited history.
        </p>
      </section>

      <p className="text-sm text-muted-foreground">
        Public REST API documentation:{' '}
        <a href="/api/docs" className="font-semibold text-primary underline">
          /api/docs (Swagger)
        </a>
      </p>
    </div>
  );
}
