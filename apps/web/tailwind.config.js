/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        // CSS 토큰(:root --brand)과 단일 소스 동기화 — Tailwind 유틸과 인라인 토큰 색 일치
        brand: {
          50: '#f3effe',
          500: 'var(--brand)',
          600: 'var(--brand-dark)',
          700: 'var(--brand-dark)',
          DEFAULT: 'var(--brand)',
        },
      },
    },
  },
  plugins: [],
}
