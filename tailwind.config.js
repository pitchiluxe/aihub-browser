/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx,html}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        aihub: {
          bg:           'rgb(var(--aihub-bg) / <alpha-value>)',
          surface:      'rgb(var(--aihub-surface) / <alpha-value>)',
          card:         'rgb(var(--aihub-card) / <alpha-value>)',
          border:       'rgb(var(--aihub-border) / <alpha-value>)',
          accent:       'rgb(var(--aihub-accent) / <alpha-value>)',
          'accent-glow':'rgb(var(--aihub-accent-glow) / <alpha-value>)',
          violet:       'rgb(var(--aihub-violet) / <alpha-value>)',
          cyan:         'rgb(var(--aihub-cyan) / <alpha-value>)',
          green:        'rgb(var(--aihub-green) / <alpha-value>)',
          orange:       'rgb(var(--aihub-orange) / <alpha-value>)',
          text:         'rgb(var(--aihub-text) / <alpha-value>)',
          muted:        'rgb(var(--aihub-muted) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow':  'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':        'glow 2s ease-in-out infinite alternate',
        'float':       'float 6s ease-in-out infinite',
        'spin-slow':   'spin 20s linear infinite',
        'fade-in':     'fadeIn 0.2s ease-out',
        'slide-up':    'slideUp 0.25s ease-out',
        'ai-pulse':    'aiPulse 2s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px #3b82f6, 0 0 10px #3b82f6' },
          '100%': { boxShadow: '0 0 10px #3b82f6, 0 0 25px #3b82f6, 0 0 50px #3b82f6' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        aiPulse: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.7', transform: 'scale(1.05)' },
        },
      },
      backdropBlur: { xs: '2px' },
      boxShadow: {
        'glow-blue':   '0 0 20px rgba(59,130,246,0.30)',
        'glow-violet': '0 0 20px rgba(139,92,246,0.30)',
        'glow-cyan':   '0 0 20px rgba(6,182,212,0.30)',
        'panel':       '0 4px 24px 0 rgba(0,0,0,0.40)',
        'panel-lg':    '0 8px 48px 0 rgba(0,0,0,0.60)',
      },
    }
  },
  plugins: []
}
