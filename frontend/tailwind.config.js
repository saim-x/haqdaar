/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens — docs/11 §2.4 (WCAG AA on the warm paper background).
        paper: '#FFFBF5',
        ink: '#1B1B1B',
        'ink-soft': '#4A4A4A',
        teal: {
          50: '#EFFCF9',
          100: '#D3F5EE',
          600: '#0F766E',
          700: '#0B5F59',
          800: '#084C47',
        },
        amber: {
          50: '#FFF8E6',
          100: '#FDEFC7',
          400: '#F2B233',
          600: '#B4740A',
          700: '#8A5906',
        },
        status: {
          approved: '#0F7B3F',
          needs: '#B4740A',
          review: '#1D4ED8',
          waiting: '#475569',
          paused: '#6D28D9',
          rejected: '#B42318',
        },
      },
      fontFamily: {
        urdu: ['"Noto Sans Arabic"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        sans: ['"Noto Sans Arabic"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      minHeight: {
        tap: '48px',
        primary: '56px',
      },
      minWidth: {
        tap: '48px',
        primary: '56px',
      },
      spacing: {
        tap: '48px',
        primary: '56px',
      },
      borderRadius: {
        card: '18px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(27,27,27,0.06), 0 8px 24px -12px rgba(27,27,27,0.18)',
      },
    },
  },
  plugins: [],
};
