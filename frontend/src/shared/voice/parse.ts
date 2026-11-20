// Field-scoped parsing of a spoken transcript (client side). Mirrors the contract of
// POST /voice/transcribe-parse: never guesses — if nothing usable is heard, it returns null
// and the citizen falls back to the keypad / buttons.

const URDU_DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

// Urdu script + Roman Urdu + English number words.
const WORDS: Record<string, number> = {};
const add = (n: number, ...ws: string[]) => ws.forEach((w) => (WORDS[w] = n));
add(0, 'صفر', 'زیرو', 'sifar', 'zero', 'zeero');
add(1, 'ایک', 'ek', 'aik', 'one');
add(2, 'دو', 'do', 'two');
add(3, 'تین', 'teen', 'tin', 'three');
add(4, 'چار', 'char', 'chaar', 'four');
add(5, 'پانچ', 'panch', 'paanch', 'five');
add(6, 'چھ', 'چھے', 'chay', 'chhe', 'che', 'six');
add(7, 'سات', 'saat', 'sat', 'seven');
add(8, 'آٹھ', 'aath', 'ath', 'eight');
add(9, 'نو', 'nau', 'nine');
add(10, 'دس', 'das', 'ten');
add(11, 'گیارہ', 'gyarah', 'gyara', 'eleven');
add(12, 'بارہ', 'barah', 'bara', 'twelve');
add(13, 'تیرہ', 'terah', 'tera', 'thirteen');
add(14, 'چودہ', 'chaudah', 'chauda', 'fourteen');
add(15, 'پندرہ', 'pandrah', 'pandra', 'fifteen');
add(16, 'سولہ', 'solah', 'sola', 'sixteen');
add(17, 'سترہ', 'satrah', 'satra', 'seventeen');
add(18, 'اٹھارہ', 'atharah', 'athara', 'eighteen');
add(19, 'انیس', 'unnees', 'unees', 'nineteen');
add(20, 'بیس', 'bees', 'twenty');
add(21, 'اکیس', 'ikkees', 'ikees');
add(22, 'بائیس', 'baees', 'bais');
add(23, 'تئیس', 'teyees');
add(24, 'چوبیس', 'chaubees', 'chobees');
add(25, 'پچیس', 'pachees', 'pachis');
add(26, 'چھبیس', 'chhabbees', 'chabees');
add(27, 'ستائیس', 'sattaees', 'sataees');
add(28, 'اٹھائیس', 'athaees', 'athais', 'athaais');
add(29, 'انتیس', 'untees');
add(30, 'تیس', 'tees', 'thirty');
add(32, 'بتیس', 'battees');
add(35, 'پینتیس', 'paintees');
add(40, 'چالیس', 'chalees', 'chalis', 'forty');
add(45, 'پینتالیس', 'paintalees');
add(50, 'پچاس', 'pachaas', 'pachas', 'fifty');
add(60, 'ساٹھ', 'saath', 'sixty');
add(70, 'ستر', 'sattar', 'seventy');
add(74, 'چوہتر', 'chauhattar');
add(80, 'اسی', 'assi', 'eighty');
add(90, 'نوے', 'nabbe', 'ninety');

const MULT: Record<string, number> = {
  سو: 100, sau: 100, hundred: 100,
  ہزار: 1000, hazaar: 1000, hazar: 1000, thousand: 1000,
  لاکھ: 100000, lakh: 100000, lac: 100000,
};

export function normalize(text: string): string {
  return text
    .replace(/[۰-۹٠-٩]/g, (d) => URDU_DIGITS[d] ?? d)
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function saysUnknown(text: string): boolean {
  return /(نہیں معلوم|معلوم نہیں|پتا نہیں|پتہ نہیں|نہیں پتا|nahi pata|pata nahi|nahin maloom|maloom nahi|don ?t know|do not know|not sure)/i.test(text);
}

/** "28 ہزار" → 28000, "do hazaar paanch sau" → 2500, "28,000 rupees" → 28000. */
export function parseNumber(text: string): number | null {
  const tokens = normalize(text).split(' ');
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      current += Number(t);
      seen = true;
    } else if (t in WORDS) {
      current += WORDS[t];
      seen = true;
    } else if (t in MULT) {
      const m = MULT[t];
      if (m === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * m;
        current = 0;
      }
      seen = true;
    }
  }
  return seen ? total + current : null;
}

/** Digit-by-digit (or grouped) CNIC dictation → 13 digits, else null. */
export function parseCnic(text: string): string | null {
  let digits = '';
  for (const t of normalize(text).split(' ')) {
    if (/^\d+$/.test(t)) digits += t;
    else if (t in WORDS && WORDS[t] < 10) digits += String(WORDS[t]);
  }
  return digits.length === 13 ? digits : null;
}

export function parseYear(text: string): string | null {
  const n = normalize(text);
  const direct = n.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  if (direct) return direct[1];
  const v = parseNumber(n);
  // "انیس سو چوہتر" → 19*100 + 74
  if (v && v >= 1920 && v <= new Date().getFullYear()) return String(v);
  return null;
}

export function parsePhone(text: string): string | null {
  const d = (normalize(text).match(/\d/g) ?? []).join('') || parseCnicLike(text);
  if (!d) return null;
  if (/^03\d{9}$/.test(d)) return `+92${d.slice(1)}`;
  if (/^923\d{9}$/.test(d)) return `+${d}`;
  return null;
}
function parseCnicLike(text: string): string {
  let digits = '';
  for (const t of normalize(text).split(' ')) if (t in WORDS && WORDS[t] < 10) digits += String(WORDS[t]);
  return digits;
}

export function parseChoice<T extends { value: string; ur: string }>(text: string, options: T[]): T | null {
  const n = normalize(text);
  return (
    options.find((o) => n.includes(o.value.toLowerCase()) || n.includes(normalize(o.ur))) ??
    options.find((o) => o.value.toLowerCase().slice(0, 4) && n.includes(o.value.toLowerCase().slice(0, 4))) ??
    null
  );
}

export function cleanName(text: string): string | null {
  const t = text.replace(/[۔.,!?]+$/g, '').replace(/^(میرا نام|mera naam|my name is|naam)\s*/i, '').trim();
  if (t.length < 2) return null;
  return /[a-z]/i.test(t) ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t;
}
