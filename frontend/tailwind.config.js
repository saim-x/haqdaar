/** @type {import('tailwindcss').Config} */

/*
 * Design tokens — one warm neutral ramp, one accent, one motion curve.
 *
 * Direction: government paper and ledger ink. Surfaces stay neutral so the
 * content carries the colour; the teal is the real brand colour (it is already
 * in the PWA manifest and theme-color) and it is the only accent in the chrome.
 *
 * Contrast, measured against the page and card surfaces:
 *   ink        #1C1917 on #FAF7F1  15.9:1
 *   ink-2      #57534E on #FAF7F1   7.4:1
 *   ink-3      #8A8279 on #FAF7F1   3.6:1  (meta and captions only, never body)
 *   accent     #0F766E on #FAF7F1   4.9:1
 *   on-accent  #FFFFFF on #0F766E   4.8:1
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm neutral ramp. Page, card and raised are the only three surfaces.
        paper: '#FAF7F1',
        card: '#FFFFFF',
        raised: '#F2EDE4',
        ink: {
          DEFAULT: '#1C1917',
          2: '#57534E',
          3: '#8A8279',
        },
        // The one accent. `accent-ink` is the darker shade for accent-coloured
        // text on a light surface, where the base teal does not reach 4.5:1.
        accent: {
          DEFAULT: '#0F766E',
          ink: '#0B5F59',
          wash: '#EAF4F2',
        },
        // Semantic colours carry meaning only, toned to sit inside the ramp.
        positive: { DEFAULT: '#15803D', wash: '#EAF5EE' },
        negative: { DEFAULT: '#B42318', wash: '#FBEDEC' },
        warn: { DEFAULT: '#B45309', wash: '#FBF1E4' },
        info: { DEFAULT: '#1D4ED8', wash: '#EDF1FD' },
        paused: { DEFAULT: '#6D28D9', wash: '#F2EDFC' },
      },
      fontFamily: {
        // Noto Sans Arabic is the docs/11 §2.4 decision and the rtl.md pick for
        // "neutral, everyday". One family for both scripts keeps mixed lines in
        // one texture; the mono is a system stack, so it costs no bytes.
        sans: ['"Noto Sans Arabic"', '"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
        urdu: ['"Noto Sans Arabic"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // A short scale. Nothing below 12px: Urdu marks need the room.
        meta: ['12px', { lineHeight: '18px' }],
        caption: ['13px', { lineHeight: '20px' }],
        body: ['15px', { lineHeight: '24px' }],
        'body-lg': ['16px', { lineHeight: '26px' }],
        lead: ['18px', { lineHeight: '28px' }],
        title: ['20px', { lineHeight: '28px' }],
        'title-lg': ['24px', { lineHeight: '32px' }],
        display: ['28px', { lineHeight: '36px' }],
        'display-lg': ['32px', { lineHeight: '40px' }],
      },
      fontWeight: {
        // 700+ is banned. Hierarchy comes from size and colour.
        normal: '400',
        medium: '500',
        semibold: '600',
      },
      spacing: {
        // 4px grid, plus the two accessibility floors from docs/11 §2.4.
        tap: '48px',
        primary: '56px',
      },
      minHeight: { tap: '48px', primary: '56px' },
      minWidth: { tap: '48px', primary: '56px' },
      borderRadius: {
        // Nested radius: inner = outer − padding, never below 4.
        control: '10px',
        card: '14px',
        panel: '18px',
      },
      boxShadow: {
        // Light theme: small and neutral. No coloured shadows, no glow.
        hair: '0 1px 2px rgba(28, 25, 23, 0.05)',
        lift: '0 8px 24px rgba(28, 25, 23, 0.07)',
      },
      transitionTimingFunction: {
        // One curve for everything.
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        feedback: '120ms',
        hover: '160ms',
        popover: '200ms',
        enter: '320ms',
      },
      keyframes: {
        // The only entrance in the app: a short fade and rise.
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // A live indicator may pulse; nothing else may.
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        rise: 'rise 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        fade: 'fade 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        breathe: 'breathe 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
      },
    },
  },
  plugins: [],
};
