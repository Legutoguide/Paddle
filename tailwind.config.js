/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          bg: '#0a0e1a',
          surface: '#111827',
          surface2: '#1a2236',
          border: '#232d42',
        },
        accent: {
          DEFAULT: '#2196f3',
          hover: '#42a5f5',
          dim: '#1565c0',
        },
        cyan: {
          DEFAULT: '#22d3ee',
        },
        teal: {
          DEFAULT: '#14b8a6',
        },
        purple: {
          DEFAULT: '#8b5cf6',
        },
        pink: {
          DEFAULT: '#ec4899',
        },
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        gold: '#d4af37',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(33,150,243,0.15), 0 8px 24px -4px rgba(33,150,243,0.25)',
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 20px -6px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
};
