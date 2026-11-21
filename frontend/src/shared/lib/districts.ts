/**
 * Sindh districts offered in the wizard - docs/06 §4 rule `district_in`.
 * Frozen list: do not add districts the rule engine does not know about.
 */
export const SINDH_DISTRICTS = [
  'Thatta',
  'Badin',
  'Hyderabad',
  'Karachi',
  'Tharparkar',
  'Umerkot',
  'Mirpurkhas',
  'Sukkur',
  'Larkana',
  'Dadu',
] as const;

export type SindhDistrict = (typeof SINDH_DISTRICTS)[number];

/** Urdu labels for the pictogram list (docs/11 §3.2 step 7). */
export const DISTRICT_UR: Record<SindhDistrict, string> = {
  Thatta: 'ٹھٹھہ',
  Badin: 'بدین',
  Hyderabad: 'حیدرآباد',
  Karachi: 'کراچی',
  Tharparkar: 'تھرپارکر',
  Umerkot: 'عمرکوٹ',
  Mirpurkhas: 'میرپورخاص',
  Sukkur: 'سکھر',
  Larkana: 'لاڑکانہ',
  Dadu: 'دادو',
};

export const DISTRICT_SD: Record<SindhDistrict, string> = {
  Thatta: 'ٺٽو',
  Badin: 'بدين',
  Hyderabad: 'حيدرآباد',
  Karachi: 'ڪراچي',
  Tharparkar: 'ٿرپارڪر',
  Umerkot: 'عمرڪوٽ',
  Mirpurkhas: 'ميرپورخاص',
  Sukkur: 'سکر',
  Larkana: 'لاڙڪاڻو',
  Dadu: 'دادو',
};

export function districtLabel(district: string, lang: 'ur' | 'sd' | 'en'): string {
  if (lang === 'en') return district;
  if (lang === 'sd') return DISTRICT_SD[district as SindhDistrict] ?? district;
  return DISTRICT_UR[district as SindhDistrict] ?? district;
}
