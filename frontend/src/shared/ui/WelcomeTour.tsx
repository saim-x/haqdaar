import type { Role } from '../api/types';
import { RoamingTour, type TourStop } from './RoamingTour';

const stops: Record<Role, readonly [TourStop, ...TourStop[]]> = {
  CITIZEN: [
    { to: '/c', anchor: 'application', title: ['Apply for support', 'امداد کے لیے درخواست دیں'], text: ['Start here to apply or reopen a case. Keep your ID card and any documents the program asks for handy. You can answer one question at a time by speaking or tapping.', 'درخواست شروع کرنے یا پرانی درخواست کھولنے کے لیے یہاں دبائیں۔ شناختی کارڈ اور پروگرام کی مانگی گئی دستاویزات ساتھ رکھیں۔ ایک وقت میں ایک جواب بولیں یا بٹن دبائیں۔'], question: ['What documents do I need for the Sahara Widow Support Grant?', 'سہارا بیوہ امداد کے لیے کون سی دستاویزات چاہییں؟'] },
    { to: '/c', anchor: 'listen-button', title: ['Listen to instructions', 'ہدایات سنیں'], text: ['Tap this speaker to hear instructions in Urdu. In the application, the microphone button lets you speak an answer. Check the answer before confirming it.', 'اردو میں ہدایات سننے کے لیے اسپیکر دبائیں۔ درخواست میں مائیک دبا کر جواب بولیں۔ تصدیق سے پہلے جواب دیکھ لیں۔'] },
    { to: '/c/cases', anchor: 'case-entry', title: ['Check your application', 'اپنی درخواست دیکھیں'], text: ['Open My cases to see what happened and whether you need to do anything next.', 'میری درخواستیں کھولیں۔ یہاں اپنی درخواست کی حالت اور اگلا قدم دیکھیں۔'] },
    { to: '/scam-check', anchor: 'scam-input', title: ['Check a suspicious message', 'مشکوک پیغام کی جانچ کریں'], text: ['Paste a message you are unsure about before following a link or sharing details.', 'اگر کسی پیغام پر شک ہو تو لنک کھولنے یا معلومات دینے سے پہلے یہاں اس کی جانچ کریں۔'] },
    { to: '/c/consent', anchor: 'my-data', title: ['Control who can see your data', 'اپنی معلومات کی اجازت سنبھالیں'], text: ['See who has permission, withdraw it, or open My data to request a correction.', 'دیکھیں کس کو اجازت ہے، اجازت واپس لیں، یا معلومات درست کرنے کی درخواست دیں۔'] },
    { to: '/c/ask', anchor: 'ask-input', title: ['Ask about the rules', 'قواعد کے بارے میں پوچھیں'], text: ['Ask what documents you need or how a program works.', 'پوچھیں کہ کون سی دستاویزات چاہییں یا پروگرام کیسے کام کرتا ہے۔'] },
  ],
  HELPER: [
    { to: '/h', anchor: 'family-search', title: ['Find a family', 'خاندان تلاش کریں'], text: ['Select a family from your list. Check the name before opening or changing a case.', 'فہرست سے خاندان چنیں۔ درخواست کھولنے یا بدلنے سے پہلے نام دیکھیں۔'] },
    { to: '/h', anchor: 'add-family', title: ['Add a family', 'خاندان شامل کریں'], text: ['Start here if the family is not on your list. Have the details you need and make sure the family agrees to your help.', 'اگر خاندان فہرست میں نہیں ہے تو یہاں سے شروع کریں۔ ضروری معلومات ساتھ رکھیں اور پہلے خاندان کی رضامندی لیں۔'] },
    { to: '/h/new', anchor: 'family-consent', title: ['Capture permission', 'اجازت حاصل کریں'], text: ['Use the phone code or record witnessed verbal permission. Follow the form before accessing a family’s information.', 'فون کوڈ استعمال کریں یا گواہ کے ساتھ زبانی اجازت ریکارڈ کریں۔ خاندان کی معلومات دیکھنے سے پہلے یہ مرحلے مکمل کریں۔'] },
    { to: '/h', anchor: 'family-search', title: ['Switch families safely', 'خاندان احتیاط سے بدلیں'], text: ['Return to the roster when finished and select the next family. Keep each family’s cases separate.', 'کام مکمل ہو تو فہرست پر واپس جائیں اور اگلا خاندان چنیں۔ ہر خاندان کی درخواستیں الگ رکھیں۔'] },
  ],
  OFFICER: [
    { to: '/staff/queue', anchor: 'queue-filters', title: ['Review cases', 'درخواستوں کا جائزہ لیں'], text: ['Open a case in the queue. Read the evidence and the handoff before deciding or asking for more information.', 'فہرست سے درخواست کھولیں۔ فیصلہ کرنے یا مزید معلومات مانگنے سے پہلے ثبوت اور نوٹ پڑھیں۔'] },
    { to: '/staff/eval', title: ['Check how decisions perform', 'فیصلوں کی کارکردگی دیکھیں'], text: ['Open Evaluation to see the cost of approval errors and when cases go to human review.', 'کارکردگی کھولیں اور دیکھیں کہ غلط منظوری کی کیا قیمت ہے اور کون سے کیس انسانی جائزے میں جاتے ہیں۔'] },
    { to: '/staff/analytics', title: ['See case trends', 'درخواستوں کے رجحانات دیکھیں'], text: ['Use Analytics to see how cases move through your department.', 'تجزیات میں دیکھیں کہ آپ کے محکمے میں درخواستیں کیسے آگے بڑھ رہی ہیں۔'] },
  ],
  ADMIN: [
    { to: '/admin/rules', anchor: 'rule-draft', title: ['Manage eligibility rules', 'اہلیت کے قواعد سنبھالیں'], text: ['Use the Digital Twin to preview a rule change on past cases before publishing it.', 'قاعدہ شائع کرنے سے پہلے ڈیجیٹل ٹوئن میں پرانی درخواستوں پر اس کا اثر دیکھیں۔'] },
    { to: '/admin/users', title: ['Manage users', 'صارفین کو سنبھالیں'], text: ['Open Users to manage accounts and their roles.', 'اکاؤنٹس اور ان کے کردار سنبھالنے کے لیے صارفین کھولیں۔'] },
    { to: '/admin/api-keys', title: ['Manage access keys', 'رسائی کی کلیدیں سنبھالیں'], text: ['Use API keys for authorized integrations.', 'اجازت یافتہ سروسز کے لیے اے پی آئی کی کلیدیں استعمال کریں۔'] },
    { to: '/admin/jobs', title: ['Check background jobs', 'پس منظر کے کام دیکھیں'], text: ['Open Jobs to see work that is waiting or needs attention.', 'رکے ہوئے یا توجہ طلب کام دیکھنے کے لیے کاموں کی فہرست کھولیں۔'] },
    { to: '/admin/mocks', title: ['Check simulated services', 'آزمائشی سروسز دیکھیں'], text: ['Open Mock services to check the simulated services available to your role.', 'اپنے کردار کے لیے دستیاب آزمائشی سروسز دیکھنے کے لیے ان کی فہرست کھولیں۔'] },
  ],
  AUDITOR: [
    { to: '/auditor/events', anchor: 'verify-audit', title: ['Review the audit log', 'آڈٹ ریکارڈ دیکھیں'], text: ['Find an event to see what happened and when. Open its case trace when available.', 'دیکھیں کیا ہوا اور کب ہوا۔ جہاں موجود ہو وہاں درخواست کا ریکارڈ کھولیں۔'] },
    { to: '/auditor/consents', title: ['Review consent history', 'اجازت کا ریکارڈ دیکھیں'], text: ['See grants, withdrawals, and allowed or blocked access.', 'دی گئی اور واپس لی گئی اجازتیں اور منظور یا روکی گئی رسائی دیکھیں۔'] },
    { to: '/staff/eval', title: ['Review evaluation results', 'جانچ کے نتائج دیکھیں'], text: ['Check how the system measures errors and routes uncertain cases.', 'دیکھیں کہ نظام غلطیوں کی پیمائش کیسے کرتا ہے اور غیر یقینی کیس کہاں بھیجتا ہے۔'] },
  ],
};

export function WelcomeTour({ accountId, role }: { accountId: string; role: Role }) {
  return <RoamingTour accountId={accountId} role={role} pages={stops[role]} />;
}
