import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
// Every colour is a semantic token backed by a CSS variable in src/index.css.
// Components never use raw hex values: switching theme = editing index.css once.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderColor: { DEFAULT: token('border-default') },
      ringColor: { DEFAULT: token('focus-ring') },
      colors: {
        page: token('surface-page'),
        surface: token('surface-raised'),
        sunken: token('surface-sunken'),
        ink: token('text-primary'),
        muted: token('text-secondary'),
        line: token('border-default'),
        'line-strong': token('border-strong'),
        brand: token('action-primary'),
        'brand-hover': token('action-primary-hover'),
        'brand-ink': token('action-primary-text'),
        'brand-soft': token('action-primary-soft'),
        accent: token('accent'),
        ok: token('feedback-success'),
        'ok-soft': token('feedback-success-soft'),
        warn: token('feedback-warning'),
        'warn-soft': token('feedback-warning-soft'),
        danger: token('feedback-error'),
        'danger-hover': token('feedback-error-hover'),
        'danger-soft': token('feedback-error-soft'),
        info: token('feedback-info'),
        'info-soft': token('feedback-info-soft'),
        consent: token('feedback-consent'),
        'consent-soft': token('feedback-consent-soft'),
        neutral: token('feedback-neutral'),
        'neutral-soft': token('feedback-neutral-soft'),
        banner: token('banner-bg'),
        'banner-ink': token('banner-text'),
        focus: token('focus-ring'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        urdu: ['"Noto Sans Arabic"', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: '1rem',
        control: '0.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow-color) / 0.06), 0 4px 16px rgb(var(--shadow-color) / 0.06)',
        lift: '0 2px 4px rgb(var(--shadow-color) / 0.08), 0 12px 32px rgb(var(--shadow-color) / 0.12)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
      },
      minHeight: { tap: '48px', 'tap-lg': '56px' },
      minWidth: { tap: '48px', 'tap-lg': '56px' },
    },
  },
  plugins: [animate],
};
