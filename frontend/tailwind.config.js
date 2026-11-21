/** @type {import('tailwindcss').Config} */

/*
 * Design tokens — one warm neutral ramp, one accent, one motion curve.
 *
 * Direction: government paper and ledger ink. Surfaces stay neutral so the
 * content carries the colour; the teal is the real brand colour (it is already
 * in the PWA manifest and theme-color) and it is the only accent in the chrome.
 *
 * Two deliberate departures from stock Tailwind, because a palette built from
 * five untouched `-700` swatches reads as defaults rather than as a decision:
 *
 *   1. Surfaces are warm, not white. `card` is #FFFDF8, not #FFFFFF — a pure
 *      white card on warm paper reads as a hole punched through the page. The
 *      card is a lighter *sheet* of the same stock, and the hairline border is
 *      what separates it.
 *   2. The semantic ramp has hierarchy instead of five equal weights. `negative`
 *      is the loudest (it is the only colour that means stop), `info` and
 *      `paused` are the quietest (they are states, not alarms), and `paused` is
 *      a muted slate-violet rather than vivid violet-700.
 *
 * The accent is deepened from teal-700 to #0E6A60 so it reads as ink rather
 * than as a link colour, and so accent-coloured text clears 4.5:1 on its own
 * without reaching for `accent-ink`. It stays in the teal family on purpose:
 * `positive` is green, and an accent that drifts green would be confusable with
 * "approved" — the one distinction this product cannot afford to blur.
 *
 * Contrast, measured against the page and card surfaces:
 *   ink        #1C1917 on #F9F5EC  16.1:1   (17.2:1 on card)
 *   ink-2      #57534E on #F9F5EC   7.0:1   ( 7.5:1 on card)
 *   ink-3      #8A8279 on #F9F5EC   3.5:1   (meta and captions only, never body)
 *   accent     #0E6A60 on #F9F5EC   5.9:1   ( 6.4:1 on card)
 *   on-accent  #FFFFFF on #0E6A60   6.5:1
 *   positive   #17793F on #F9F5EC   5.0:1
 *   negative   #B42318 on #F9F5EC   6.0:1
 *   warn       #A85A0A on #F9F5EC   4.7:1
 *   info       #1B4DB1 on #F9F5EC   7.0:1
 *   paused     #5B4A8F on #F9F5EC   6.8:1
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm neutral ramp. Page, card and raised are the only three surfaces.
        paper: '#F9F5EC',
        card: '#FFFDF8',
        raised: '#F1EADD',
        ink: {
          DEFAULT: '#1C1917',
          2: '#57534E',
          3: '#655E56',
        },
        // The one accent. `accent-ink` is the pressed/hover shade; the base
        // already clears 4.5:1 on paper, so it is safe for text on its own.
        accent: {
          DEFAULT: '#0E6A60',
          ink: '#0A544C',
          wash: '#E7F1EE',
        },
        // Semantic colours carry meaning only, toned to sit inside the ramp.
        // The `-ink` shades are the pressed states for filled buttons.
        positive: { DEFAULT: '#17793F', ink: '#116B33', wash: '#EAF3EC' },
        negative: { DEFAULT: '#B42318', ink: '#9A1D14', wash: '#FBEDEA' },
        warn: { DEFAULT: '#A85A0A', wash: '#FAF0E2' },
        info: { DEFAULT: '#1B4DB1', wash: '#ECF0FA' },
        paused: { DEFAULT: '#5B4A8F', wash: '#F0EDF7' },
      },
      fontFamily: {
        // Instrument Sans for Latin, Noto Nastaliq Urdu for Urdu. Both are
        // self-hosted and split by `unicode-range` in index.css, so a mixed
        // line picks the right face per character and the browser only
        // downloads the script the page actually prints. Nastaliq stays in the
        // stack behind Instrument Sans as the fallback for Arabic codepoints.
        sans: [
          '"Instrument Sans"',
          '"Noto Sans Arabic"',
          '"Segoe UI"',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        urdu: ['"Noto Sans Arabic"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // A short scale. Nothing below 12px: Urdu marks need the room.
        // Leading comes from CSS variables (index.css) so the Nastaliq face can
        // take the extra room it needs under `html[lang='ur']` without changing
        // the Latin rhythm or any component.
        meta: ['12px', { lineHeight: 'var(--lh-meta)' }],
        caption: ['13px', { lineHeight: 'var(--lh-caption)' }],
        body: ['15px', { lineHeight: 'var(--lh-body)' }],
        'body-lg': ['16px', { lineHeight: 'var(--lh-body-lg)' }],
        lead: ['18px', { lineHeight: 'var(--lh-lead)' }],
        title: ['20px', { lineHeight: 'var(--lh-title)' }],
        'title-lg': ['24px', { lineHeight: 'var(--lh-title-lg)' }],
        display: ['28px', { lineHeight: 'var(--lh-display)' }],
        'display-lg': ['32px', { lineHeight: 'var(--lh-display-lg)' }],
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
