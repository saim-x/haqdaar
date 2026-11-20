import type { RagAnswer, RuleSet } from '../api/types';

// Tiny lexical retriever over bilingual policy snippets with an abstention gate.
// Dev-mock stand-in for backend/app/ai/rag.py (hybrid tsvector + cosine).

interface Chunk {
  doc: string;
  section: string;
  version: string;
  keys: string[];
  en: string;
  ur: string;
}

function chunks(rules: RuleSet, ruleVersion: number): Chunk[] {
  const income = rules.eligibility_rules.find((r) => r.fact === 'monthly_income_pkr')?.value as number | undefined;
  const f = rules.benefit_formula;
  const fmt = (n: number) => new Intl.NumberFormat('en-PK').format(n);
  return [
    {
      doc: 'Current eligibility rules (auto-generated)',
      section: 'Who can apply',
      version: `v${ruleVersion}`,
      keys: ['who', 'apply', 'eligible', 'eligibility', 'qualify', 'کون', 'درخواست', 'اہل', 'widow', 'بیوہ'],
      en: `Widowed women aged 18 or more living in an eligible Sindh district can apply. Monthly household income must be at most PKR ${fmt(income ?? 40000)}. The husband's death must be verified through the civil registry or a death certificate.`,
      ur: `سندھ کے اہل ضلع میں رہنے والی 18 سال یا زیادہ عمر کی بیوہ خواتین درخواست دے سکتی ہیں۔ گھریلو ماہانہ آمدنی ${fmt(income ?? 40000)} روپے یا کم ہونی چاہیے۔ شوہر کی وفات کی تصدیق سول ریکارڈ یا وفات سرٹیفکیٹ سے ہونی چاہیے۔`,
    },
    {
      doc: 'Current eligibility rules (auto-generated)',
      section: 'Grant amount',
      version: `v${ruleVersion}`,
      keys: ['amount', 'how much', 'money', 'grant', 'pkr', 'rupees', 'رقم', 'کتنی', 'روپے', 'پیسے', 'child', 'بچے'],
      en: `The grant is PKR ${fmt(f.base_amount_pkr)} plus PKR ${fmt(f.per_child_bonus_pkr)} for each child under 18 (up to ${f.max_children_counted} children), with a maximum of PKR ${fmt(f.hard_cap_pkr)}.`,
      ur: `گرانٹ ${fmt(f.base_amount_pkr)} روپے ہے، اور 18 سال سے کم ہر بچے کے لیے ${fmt(f.per_child_bonus_pkr)} روپے اضافی (زیادہ سے زیادہ ${f.max_children_counted} بچے)، کل حد ${fmt(f.hard_cap_pkr)} روپے۔`,
    },
    {
      doc: 'Sahara Widow Grant Policy',
      section: 'Required documents',
      version: '1.0',
      keys: ['document', 'documents', 'papers', 'cnic', 'certificate', 'دستاویز', 'دستاویزات', 'شناختی', 'سرٹیفکیٹ', 'کاغذ'],
      en: "You need a photo of the front of your CNIC. A photo of your husband's death certificate helps; if you do not have it, the civil registry is checked instead.",
      ur: 'آپ کو شناختی کارڈ کے سامنے کی تصویر چاہیے۔ شوہر کے وفات سرٹیفکیٹ کی تصویر مددگار ہے؛ نہ ہو تو سول ریکارڈ چیک کیا جاتا ہے۔',
    },
    {
      doc: 'Consent and Privacy Rights',
      section: 'Taking back permission',
      version: '1.0',
      keys: ['consent', 'permission', 'withdraw', 'take back', 'data', 'privacy', 'اجازت', 'واپس', 'ڈیٹا'],
      en: 'Open "My data & permissions" and tap "Withdraw access" on any card. Access stops immediately and every later attempt is shown to you as blocked. If an application is open, it pauses until you give permission again.',
      ur: '"میرا ڈیٹا اور اجازت" کھولیں اور کسی بھی کارڈ پر "اجازت واپس لیں" دبائیں۔ رسائی فوراً بند ہو جاتی ہے اور ہر کوشش آپ کو روکی ہوئی نظر آتی ہے۔ کھلی درخواست دوبارہ اجازت دینے تک رک جاتی ہے۔',
    },
    {
      doc: 'Scam Safety Guide',
      section: 'How to spot a fake message',
      version: '1.0',
      keys: ['scam', 'fake', 'fraud', 'message', 'sms', 'fee', 'pin', 'دھوکہ', 'جعلی', 'پیغام', 'فیس'],
      en: 'Haqdaar never asks for a fee, PIN or OTP. Every real message carries an HQ- verification code that you can check on the "Check a message" screen.',
      ur: 'حقدار کبھی فیس، PIN یا OTP نہیں مانگتا۔ ہر اصلی پیغام میں HQ- تصدیقی کوڈ ہوتا ہے جسے "پیغام چیک کریں" پر جانچا جا سکتا ہے۔',
    },
    {
      doc: 'Sahara Widow Grant Policy',
      section: 'Payment and complaints',
      version: '1.0',
      keys: ['payment', 'paid', 'raast', 'received', 'complaint', 'ادائیگی', 'شکایت', 'راسط', 'ملی'],
      en: 'Approved grants are sent to your Raast mobile number. If the money does not arrive, open your application and tap "Money not received" to file a complaint.',
      ur: 'منظور شدہ رقم آپ کے راسط موبائل نمبر پر بھیجی جاتی ہے۔ رقم نہ ملے تو اپنی درخواست کھول کر "رقم نہیں ملی" دبائیں۔',
    },
  ];
}

const PERSONAL = /(will i|do i qualify|am i eligible|کیا مجھے ملے|میں اہل)/i;

export function answerQuestion(q: string, lang: 'ur' | 'en', rules: RuleSet, ruleVersion: number): RagAnswer {
  const text = q.toLowerCase();
  const scored = chunks(rules, ruleVersion)
    .map((c) => ({ c, score: c.keys.reduce((s, k) => (text.includes(k) ? s + (k.length > 4 ? 0.3 : 0.22) : s), 0) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const topScore = Math.min(0.95, Math.round(top.score * 100) / 100);
  if (topScore < 0.25) {
    return { status: 'NOT_SURE', answer: '', citations: [], top_score: topScore };
  }
  const used = scored.filter((s) => s.score >= Math.max(0.22, top.score * 0.7)).slice(0, 2);
  let answer = used.map((u) => (lang === 'ur' ? u.c.ur : u.c.en)).join('\n\n');
  if (PERSONAL.test(q)) {
    answer +=
      lang === 'ur'
        ? '\n\nہم کسی کی ذاتی اہلیت کا فیصلہ یہاں نہیں کرتے۔ جاننے کے لیے درخواست جمع کرائیں۔'
        : '\n\nWe do not decide personal eligibility here. Submit an application to find out.';
  }
  return {
    status: 'ANSWERED',
    answer,
    citations: used.map((u) => ({ doc_title: u.c.doc, section: u.c.section, version: u.c.version, excerpt: u.c.en.slice(0, 140), score: Math.min(0.95, u.score) })),
    top_score: topScore,
  };
}
