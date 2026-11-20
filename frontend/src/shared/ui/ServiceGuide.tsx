import { ChevronDown, FileCheck2, Mic, ShieldCheck, WifiOff } from 'lucide-react';
import { useT } from '../i18n';

export function ServiceGuide() {
  const { pick } = useT();
  const items = [
    {
      icon: Mic,
      title: pick('پڑھنا مشکل ہے؟ ہم سناتے ہیں', 'Prefer to listen?'),
      body: pick(
        'اسپیکر دبائیں، ہم سوال پڑھ کر سنائیں گے۔ آپ بول کر یا ٹیپ کر کے جواب دے سکتی ہیں۔',
        'Tap a speaker to hear the question. Answer by speaking, typing, or tapping a choice.',
      ),
    },
    {
      icon: FileCheck2,
      title: pick('درخواست کے لیے کیا چاہیے؟', 'What should I have ready?'),
      body: pick(
        'اپنا شناختی کارڈ اور ادائیگی کا موبائل نمبر پاس رکھیں۔ سہارا گرانٹ کے لیے شوہر کی معلومات بھی پوچھی جائیں گی۔ جو معلوم نہ ہو، بتا دیں۔',
        'Have your CNIC and payout mobile number nearby. Sahara also asks about your spouse. If you do not know an answer, you can tell us.',
      ),
    },
    {
      icon: WifiOff,
      title: pick('انٹرنیٹ بند ہو جائے تو؟', 'What if my connection drops?'),
      body: pick(
        'آپ کے جواب اسی فون پر محفوظ رہتے ہیں۔ ایپ دوبارہ کھول کر جاری رکھیں۔ جمع کی گئی درخواست انٹرنیٹ واپس آنے پر بھیجی جائے گی۔',
        'Your answers stay saved on this device. Open the app to continue. A queued submission sends when your connection returns.',
      ),
    },
    {
      icon: ShieldCheck,
      title: pick('میری معلومات کس کو ملتی ہیں؟', 'Who can see my information?'),
      body: pick(
        'آپ اجازت منتخب کرتی ہیں۔ اجازت والے صفحے پر دیکھیں کہ کس نے معلومات دیکھی ہیں، اور جب چاہیں اجازت واپس لیں۔',
        'You choose who has permission. Visit Permissions to review access and withdraw it whenever you choose.',
      ),
    },
  ];
  return (
    <section
      aria-label={pick('آپ کی رہنمائی', 'A little guidance')}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <p className="eyebrow">{pick('ہر قدم پر ساتھ', 'Here to help')}</p>
      <h2 className="mt-1 text-xl font-bold tracking-tight">
        {pick('آپ اپنے وقت پر کریں', 'At your own pace.')}
      </h2>
      <div className="mt-4 divide-y divide-border">
        {items.map(({ icon: Icon, title, body }) => (
          <details key={title} className="group">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="flex-1">{title}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="pb-4 ps-7 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
