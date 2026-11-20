/** The 9 seeded demo personas — docs/10 §2. Keys are the `/auth/demo-login` contract. */
import type { Role } from '../api/types';

export type PersonaKey =
  | 'widow_fatima'
  | 'shopkeeper_rasool'
  | 'helper_ayesha'
  | 'officer_sana'
  | 'officer_imran'
  | 'admin_bilal'
  | 'admin_platform'
  | 'auditor_nadia'
  | 'officer_zakat';

export interface Persona {
  key: PersonaKey;
  role: Role;
  name: string;
  nameUr: string;
  blurbEn: string;
  blurbUr: string;
  tenant: string | null;
  /** Where this persona lands after login. */
  home: string;
  accent: string;
}

export const PERSONAS: Persona[] = [
  {
    key: 'widow_fatima',
    role: 'CITIZEN',
    name: 'Fatima Bibi',
    nameUr: 'فاطمہ بی بی',
    blurbEn: 'Widow, Thatta. Cannot read. Weak signal.',
    blurbUr: 'بیوہ، ٹھٹھہ۔ پڑھ نہیں سکتیں۔ سگنل کمزور ہے۔',
    tenant: null,
    home: '/c',
    accent: '#0F766E',
  },
  {
    key: 'shopkeeper_rasool',
    role: 'CITIZEN',
    name: 'Rasool Bakhsh',
    nameUr: 'رسول بخش',
    blurbEn: 'Shopkeeper, Hyderabad. Checks scam messages.',
    blurbUr: 'دکاندار، حیدرآباد۔ جعلی پیغام چیک کرتے ہیں۔',
    tenant: null,
    home: '/c',
    accent: '#B4740A',
  },
  {
    key: 'helper_ayesha',
    role: 'HELPER',
    name: 'Ayesha Khatoon',
    nameUr: 'عائشہ خاتون',
    blurbEn: 'Community helper. 40 families, one shared phone.',
    blurbUr: 'کمیونٹی مددگار۔ 40 گھرانے، ایک فون۔',
    tenant: null,
    home: '/h',
    accent: '#6D28D9',
  },
  {
    key: 'officer_sana',
    role: 'OFFICER',
    name: 'Sana Qureshi',
    nameUr: 'ثنا قریشی',
    blurbEn: 'Case officer, Social Protection Dept.',
    blurbUr: 'کیس افسر، محکمہ سماجی بہبود۔',
    tenant: 'SPD',
    home: '/staff/queue',
    accent: '#1D4ED8',
  },
  {
    key: 'officer_imran',
    role: 'OFFICER',
    name: 'Imran Siddiqui',
    nameUr: 'عمران صدیقی',
    blurbEn: 'Second officer — four-eyes approver.',
    blurbUr: 'دوسرے افسر — حتمی منظوری۔',
    tenant: 'SPD',
    home: '/staff/queue',
    accent: '#1D4ED8',
  },
  {
    key: 'admin_bilal',
    role: 'ADMIN',
    name: 'Bilal Ahmed',
    nameUr: 'بلال احمد',
    blurbEn: 'Tenant admin. Rules, users, keys.',
    blurbUr: 'ٹیننٹ ایڈمن۔ قواعد، صارفین، چابیاں۔',
    tenant: 'SPD',
    home: '/admin/rules',
    accent: '#0B5F59',
  },
  {
    key: 'admin_platform',
    role: 'ADMIN',
    name: 'Platform Admin',
    nameUr: 'پلیٹ فارم ایڈمن',
    blurbEn: 'Operates the platform and mock services.',
    blurbUr: 'پلیٹ فارم اور نقلی خدمات چلاتے ہیں۔',
    tenant: null,
    home: '/admin/mocks',
    accent: '#0B5F59',
  },
  {
    key: 'auditor_nadia',
    role: 'AUDITOR',
    name: 'Nadia Farooq',
    nameUr: 'نادیہ فاروق',
    blurbEn: 'Independent auditor. Read-only.',
    blurbUr: 'آزاد آڈیٹر۔ صرف پڑھ سکتی ہیں۔',
    tenant: null,
    home: '/auditor/events',
    accent: '#475569',
  },
  {
    key: 'officer_zakat',
    role: 'OFFICER',
    name: 'Tariq Mehmood',
    nameUr: 'طارق محمود',
    blurbEn: 'Zakat & Welfare Board — tenant isolation proof.',
    blurbUr: 'زکوٰۃ اینڈ ویلفیئر بورڈ — ٹیننٹ علیحدگی۔',
    tenant: 'ZWB',
    home: '/staff/queue',
    accent: '#B4740A',
  },
];

export function personaByKey(key: string): Persona | undefined {
  return PERSONAS.find((p) => p.key === key);
}
