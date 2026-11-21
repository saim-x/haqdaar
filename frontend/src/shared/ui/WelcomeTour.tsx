import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAudio } from '../audio/AudioProvider';
import { useI18n } from '../i18n/I18nProvider';
import { AudioButton } from './AudioButton';

type Copy = readonly [en: string, ur: string];
type Stop = { to: string; title: Copy; text: Copy };

const stops: Record<Role, readonly [Stop, ...Stop[]]> = {
  CITIZEN: [
    { to: '/c', title: ['Apply for support', 'امداد کے لیے درخواست دیں'], text: ['Choose Apply on your home screen. Answer one question at a time with your voice or by tapping.', 'اپنے ہوم پر درخواست دیں دبائیں۔ ایک وقت میں ایک سوال کا جواب بول کر یا بٹن دبا کر دیں۔'] },
    { to: '/c/cases', title: ['Check your application', 'اپنی درخواست دیکھیں'], text: ['Open My cases to see what happened and whether you need to do anything next.', 'میری درخواستیں کھولیں۔ یہاں اپنی درخواست کی حالت اور اگلا قدم دیکھیں۔'] },
    { to: '/scam-check', title: ['Check a suspicious message', 'مشکوک پیغام کی جانچ کریں'], text: ['Paste a message you are unsure about before following a link or sharing details.', 'اگر کسی پیغام پر شک ہو تو لنک کھولنے یا معلومات دینے سے پہلے یہاں اس کی جانچ کریں۔'] },
    { to: '/c/consent', title: ['Control who can see your data', 'اپنی معلومات کی اجازت سنبھالیں'], text: ['See who has permission, withdraw it, or open My data to request a correction.', 'دیکھیں کس کو اجازت ہے، اجازت واپس لیں، یا معلومات درست کرنے کی درخواست دیں۔'] },
    { to: '/c/ask', title: ['Ask about the rules', 'قواعد کے بارے میں پوچھیں'], text: ['Ask what documents you need or how a program works.', 'پوچھیں کہ کون سی دستاویزات چاہییں یا پروگرام کیسے کام کرتا ہے۔'] },
  ],
  HELPER: [
    { to: '/h', title: ['Find a family', 'خاندان تلاش کریں'], text: ['Select a family from your list. Check the name before opening or changing a case.', 'فہرست سے خاندان چنیں۔ درخواست کھولنے یا بدلنے سے پہلے نام دیکھیں۔'] },
    { to: '/h/new', title: ['Add a family with permission', 'اجازت لے کر خاندان شامل کریں'], text: ['Use Add family and follow the consent prompts before viewing information.', 'خاندان شامل کریں دبائیں۔ معلومات دیکھنے سے پہلے اجازت کے مراحل مکمل کریں۔'] },
    { to: '/h', title: ['Switch families safely', 'خاندان احتیاط سے بدلیں'], text: ['Return to the roster when finished and select the next family. Keep each family’s cases separate.', 'کام مکمل ہو تو فہرست پر واپس جائیں اور اگلا خاندان چنیں۔ ہر خاندان کی درخواستیں الگ رکھیں۔'] },
  ],
  OFFICER: [
    { to: '/staff/queue', title: ['Review cases', 'درخواستوں کا جائزہ لیں'], text: ['Open a case in the queue. Read the evidence and the handoff before deciding or asking for more information.', 'فہرست سے درخواست کھولیں۔ فیصلہ کرنے یا مزید معلومات مانگنے سے پہلے ثبوت اور نوٹ پڑھیں۔'] },
    { to: '/staff/eval', title: ['Check how decisions perform', 'فیصلوں کی کارکردگی دیکھیں'], text: ['Open Evaluation to see the cost of approval errors and when cases go to human review.', 'کارکردگی کھولیں اور دیکھیں کہ غلط منظوری کی کیا قیمت ہے اور کون سے کیس انسانی جائزے میں جاتے ہیں۔'] },
    { to: '/staff/analytics', title: ['See case trends', 'درخواستوں کے رجحانات دیکھیں'], text: ['Use Analytics to see how cases move through your department.', 'تجزیات میں دیکھیں کہ آپ کے محکمے میں درخواستیں کیسے آگے بڑھ رہی ہیں۔'] },
  ],
  ADMIN: [
    { to: '/admin/rules', title: ['Manage eligibility rules', 'اہلیت کے قواعد سنبھالیں'], text: ['Use the Digital Twin to preview a rule change on past cases before publishing it.', 'قاعدہ شائع کرنے سے پہلے ڈیجیٹل ٹوئن میں پرانی درخواستوں پر اس کا اثر دیکھیں۔'] },
    { to: '/admin/users', title: ['Manage users', 'صارفین کو سنبھالیں'], text: ['Open Users to manage accounts and their roles.', 'اکاؤنٹس اور ان کے کردار سنبھالنے کے لیے صارفین کھولیں۔'] },
    { to: '/admin/api-keys', title: ['Manage access keys', 'رسائی کی کلیدیں سنبھالیں'], text: ['Use API keys for authorized integrations.', 'اجازت یافتہ سروسز کے لیے اے پی آئی کی کلیدیں استعمال کریں۔'] },
    { to: '/admin/jobs', title: ['Check background jobs', 'پس منظر کے کام دیکھیں'], text: ['Open Jobs to see work that is waiting or needs attention.', 'رکے ہوئے یا توجہ طلب کام دیکھنے کے لیے کاموں کی فہرست کھولیں۔'] },
    { to: '/admin/mocks', title: ['Check simulated services', 'آزمائشی سروسز دیکھیں'], text: ['Open Mock services to check the simulated services available to your role.', 'اپنے کردار کے لیے دستیاب آزمائشی سروسز دیکھنے کے لیے ان کی فہرست کھولیں۔'] },
  ],
  AUDITOR: [
    { to: '/auditor/events', title: ['Review the audit log', 'آڈٹ ریکارڈ دیکھیں'], text: ['Find an event to see what happened and when. Open its case trace when available.', 'دیکھیں کیا ہوا اور کب ہوا۔ جہاں موجود ہو وہاں درخواست کا ریکارڈ کھولیں۔'] },
    { to: '/auditor/consents', title: ['Review consent history', 'اجازت کا ریکارڈ دیکھیں'], text: ['See grants, withdrawals, and allowed or blocked access.', 'دی گئی اور واپس لی گئی اجازتیں اور منظور یا روکی گئی رسائی دیکھیں۔'] },
    { to: '/staff/eval', title: ['Review evaluation results', 'جانچ کے نتائج دیکھیں'], text: ['Check how the system measures errors and routes uncertain cases.', 'دیکھیں کہ نظام غلطیوں کی پیمائش کیسے کرتا ہے اور غیر یقینی کیس کہاں بھیجتا ہے۔'] },
  ],
};

export function WelcomeTour({ accountId, role }: { accountId: string; role: Role }) {
  const storageKey = `haqdaar:welcome-tour:v1:${role}:${accountId}`;
  const { pick, lang } = useI18n();
  const { stop } = useAudio();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(storageKey) === 'seen'; } catch { return false; }
  });
  const pages = stops[role];
  const page = pages[step] ?? pages[0];

  useEffect(() => () => {
    if (dialog.current?.open) stop();
  }, [stop]);

  function markSeen() {
    setSeen(true);
    try { localStorage.setItem(storageKey, 'seen'); } catch { /* Storage may be disabled. */ }
  }

  function changeStep(index: number) {
    stop();
    setStep(index);
  }

  return (
    <section className="mx-auto w-full max-w-[560px] px-4 pt-3" aria-label={pick('حق دار کا تعارف', 'Haqdaar tour')}>
      <div className={seen ? 'flex justify-end' : 'flex flex-wrap items-center justify-between gap-x-3 rounded-control border border-ink/10 bg-card px-3'}>
        {!seen && <p className="text-body font-medium text-ink">{pick('پہلی بار آئے ہیں؟', 'First time here?')}</p>}
        <button ref={launcher} type="button" className="press min-h-tap rounded-control px-2 text-caption font-medium text-accent-ink hover:bg-accent-wash"
          onClick={() => { setStep(0); dialog.current?.showModal(); }}>
          {seen ? pick('تعارف دوبارہ دیکھیں', 'Replay tour') : pick('مختصر تعارف دیکھیں', 'Take a quick tour')}
        </button>
        {!seen && <button type="button" className="press min-h-tap rounded-control px-2 text-meta text-ink-3" onClick={markSeen}>{pick('ابھی نہیں', 'Skip for now')}</button>}
      </div>
      <dialog ref={dialog} aria-labelledby={titleId} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-[420px] overflow-y-auto rounded-[24px] border border-ink/10 bg-paper p-5 text-ink shadow-xl backdrop:bg-ink/45"
        onClose={() => { stop(); markSeen(); launcher.current?.focus(); }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-ink-3" aria-live="polite">
            {new Intl.NumberFormat(lang).format(step + 1)} / {new Intl.NumberFormat(lang).format(pages.length)}
          </span>
          <button type="button" className="press min-h-tap rounded-control px-2 text-caption text-ink-3" onClick={() => dialog.current?.close()}>{pick('بند کریں', 'Close tour')}</button>
        </div>
        <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-accent-wash">
          <img src="/icons/haqdaar-tour-guide.webp" width="112" height="112" loading="lazy" className="h-full w-full object-contain" alt="" />
        </div>
        <div className="mt-4 flex items-start gap-2">
          <div className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
            <h2 id={titleId} className="text-title-lg font-semibold">{pick(page.title[1], page.title[0])}</h2>
            <p className="mt-2 text-body leading-[1.7] text-ink-2">{pick(page.text[1], page.text[0])}</p>
          </div>
          <AudioButton text={`${page.title[1]}۔ ${page.text[1]}`} />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {step > 0 && <button type="button" className="press min-h-tap rounded-control px-2 text-caption text-ink-2" onClick={() => changeStep(step - 1)}>{pick('پیچھے', 'Back')}</button>}
          <Link to={page.to} onClick={() => { markSeen(); stop(); dialog.current?.close(); }} className="inline-flex min-h-tap items-center px-2 text-caption font-medium text-accent-ink underline">{pick('یہ صفحہ کھولیں', 'Open this page')}</Link>
          <button type="button" className="press ms-auto min-h-tap rounded-control bg-accent px-4 text-body font-medium text-white" onClick={() => step + 1 === pages.length ? dialog.current?.close() : changeStep(step + 1)}>
            {step + 1 === pages.length ? pick('مکمل', 'Done') : pick('آگے', 'Next')}
          </button>
        </div>
      </dialog>
    </section>
  );
}
