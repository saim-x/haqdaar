import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
// One theme for the whole app. Names follow the shadcn/ui convention so shadcn and
// Watermelon UI components drop in and inherit our palette. Values live in src/index.css
// as RGB channels (light + dark); components never use raw colours.
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderColor: { DEFAULT: c('border') },
      ringColor: { DEFAULT: c('ring') },
      colors: {
        background: c('background'),
        foreground: c('foreground'),
        card: { DEFAULT: c('card'), foreground: c('card-foreground') },
        popover: { DEFAULT: c('popover'), foreground: c('popover-foreground') },
        primary: { DEFAULT: c('primary'), foreground: c('primary-foreground'), hover: c('primary-hover'), soft: c('primary-soft') },
        secondary: { DEFAULT: c('secondary'), foreground: c('secondary-foreground') },
        muted: { DEFAULT: c('muted'), foreground: c('muted-foreground') },
        accent: { DEFAULT: c('accent'), foreground: c('accent-foreground') },
        destructive: { DEFAULT: c('destructive'), foreground: c('destructive-foreground') },
        border: c('border'),
        input: c('input'),
        ring: c('ring'),
        // Status tints (text colour + soft background). Used only to convey state.
        ok: { DEFAULT: c('success'), soft: c('success-soft') },
        warn: { DEFAULT: c('warning'), soft: c('warning-soft') },
        info: { DEFAULT: c('info'), soft: c('info-soft') },
        danger: { DEFAULT: c('destructive'), soft: c('destructive-soft'), hover: c('destructive-hover') },
        consent: { DEFAULT: c('consent'), soft: c('consent-soft') },
        neutral: { DEFAULT: c('neutral'), soft: c('neutral-soft') },
        // A single warm highlight, used sparingly (brand seal, scam-check entry point).
        highlight: { DEFAULT: c('highlight'), soft: c('highlight-soft') },
        banner: { DEFAULT: c('banner-bg'), foreground: c('banner-text') },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        urdu: ['"Noto Sans Arabic"', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        card: 'calc(var(--radius) + 4px)',
        control: 'var(--radius)',
      },
      boxShadow: {
        xs: '0 1px 2px rgb(var(--shadow-color) / 0.05)',
        card: '0 1px 2px rgb(var(--shadow-color) / 0.04), 0 1px 3px rgb(var(--shadow-color) / 0.04)',
        lift: '0 4px 12px rgb(var(--shadow-color) / 0.06), 0 16px 40px rgb(var(--shadow-color) / 0.08)',
      },
      transitionDuration: { fast: '120ms', base: '200ms' },
      minHeight: { tap: '48px', 'tap-lg': '56px' },
      minWidth: { tap: '48px', 'tap-lg': '56px' },
    },
  },
  plugins: [animate],
};
