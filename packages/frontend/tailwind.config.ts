import type { Config } from 'tailwindcss'

const rose = {
  50: '#FBF4F5',
  100: '#F6E7E9',
  200: '#EDCFD3',
  300: '#DFAEB5',
  400: '#CB8D97',
  500: '#B76E79',
  600: '#A05B66',
  700: '#854A53',
  800: '#6C3D44',
  900: '#57333A',
  950: '#331D21',
}

// Neutros quentes — 50 é o fundo off-white e 900 o grafite do texto.
const warmNeutral = {
  50: '#FAF7F4',
  100: '#F3EEE9',
  200: '#E8E0D8',
  300: '#D6CBC0',
  400: '#A99D93',
  500: '#7D736C',
  600: '#5F5751',
  700: '#48423E',
  800: '#363231',
  900: '#2B2B2B',
  950: '#1E1D1D',
}

const sage = {
  50: '#F2F6F3',
  100: '#E2ECE5',
  200: '#C7DACD',
  300: '#A6C3AF',
  400: '#92B39C',
  500: '#7FA38A',
  600: '#658A71',
  700: '#50705B',
  800: '#40594A',
  900: '#34493D',
  950: '#1D2A22',
}

const terracotta = {
  50: '#FCF4F0',
  100: '#F8E6DD',
  200: '#F1CDBB',
  300: '#E8AF94',
  400: '#E09C7D',
  500: '#D98B6A',
  600: '#C07052',
  700: '#9E5A41',
  800: '#7F4935',
  900: '#683D2E',
  950: '#3A2018',
}

const gold = {
  50: '#FBF8F1',
  100: '#F5EDDB',
  200: '#EBDAB6',
  300: '#DEC48F',
  400: '#D3B67E',
  500: '#C9A96E',
  600: '#A98A52',
  700: '#866C40',
  800: '#6B5735',
  900: '#57482D',
  950: '#312818',
}

const mauve = {
  50: '#F8F3F6',
  100: '#F0E4EC',
  200: '#E0C9D8',
  300: '#CAA6BE',
  400: '#B087A3',
  500: '#966C8A',
  600: '#7E5874',
  700: '#67485F',
  800: '#553C4F',
  900: '#473343',
  950: '#2A1D27',
}

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      // Identidade ClinIQ Pro — odontologia e estética.
      // Paleta-base: off-white quente #FAF7F4, rosé queimado #B76E79, nude/areia #E8D5C4,
      // grafite #2B2B2B, dourado suave #C9A96E, verde sálvia #7FA38A e terracota #D98B6A.
      // As escalas padrão do Tailwind (slate, emerald, amber, sky…) são redefinidas
      // abaixo para que todas as telas existentes herdem a paleta sem trocar classes.
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      colors: {
        primary: rose,
        brand: {
          bg: '#FAF7F4',
          rose: '#B76E79',
          sand: '#E8D5C4',
          ink: '#2B2B2B',
          gold: '#C9A96E',
          sage: '#7FA38A',
          terracotta: '#D98B6A',
        },
        sand: {
          50: '#FCF8F5',
          100: '#F6EDE5',
          200: '#E8D5C4',
          300: '#DCC1AA',
          400: '#C9A68A',
          500: '#B38B6D',
          600: '#957157',
          700: '#775A46',
          800: '#5F4839',
          900: '#4D3B2F',
        },
        slate: warmNeutral,
        gray: warmNeutral,
        emerald: sage,
        green: sage,
        teal: sage,
        amber: terracotta,
        orange: terracotta,
        sky: gold,
        blue: gold,
        cyan: gold,
        yellow: gold,
        violet: mauve,
        purple: mauve,
        indigo: mauve,
        gold,
        sage,
        terracotta,
        mauve,
      },
      animation: {
        /* ── Entradas ── */
        'fade-in': 'fadeIn 0.35s ease-out both',
        'fade-in-fast': 'fadeIn 0.18s ease-out both',
        'fade-in-slow': 'fadeIn 0.6s ease-out both',
        'slide-in': 'slideIn 0.35s cubic-bezier(.22,1,.36,1) both',
        'slide-up': 'slideUp 0.4s cubic-bezier(.22,1,.36,1) both',
        'slide-down': 'slideDown 0.35s cubic-bezier(.22,1,.36,1) both',
        'slide-right': 'slideRight 0.35s cubic-bezier(.22,1,.36,1) both',
        'slide-left': 'slideLeft 0.35s cubic-bezier(.22,1,.36,1) both',
        'scale-in': 'scaleIn 0.25s cubic-bezier(.22,1,.36,1) both',
        'scale-in-fast': 'scaleIn 0.15s cubic-bezier(.22,1,.36,1) both',
        'zoom-in': 'zoomIn 0.3s cubic-bezier(.22,1,.36,1) both',
        'bounce-in': 'bounceIn 0.5s cubic-bezier(.22,1,.36,1) both',
        /* ── Stagger helpers ── */
        'stagger-1': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.05s both',
        'stagger-2': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.10s both',
        'stagger-3': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.15s both',
        'stagger-4': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.20s both',
        'stagger-5': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.25s both',
        'stagger-6': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.30s both',
        'stagger-7': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.35s both',
        'stagger-8': 'fadeUp 0.4s cubic-bezier(.22,1,.36,1) 0.40s both',
        /* ── Skeleton ── */
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        /* ── Contínuas ── */
        float: 'float 3s ease-in-out infinite',
        'float-slow': 'float 5s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'pulse-scale': 'pulseScale 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
        'spin-very-slow': 'spin 8s linear infinite',
        /* ── Page ── */
        'page-enter': 'pageEnter 0.4s cubic-bezier(.22,1,.36,1) both',
        'page-exit': 'pageExit 0.25s ease-in both',
        'drawer-in': 'drawerIn 0.35s cubic-bezier(.22,1,.36,1) both',
        'drawer-out': 'drawerOut 0.3s ease-in both',
        /* ── Indicadores ── */
        'ping-once': 'pingOnce 0.6s ease-out both',
        'progress-fill': 'progressFill 0.8s cubic-bezier(.22,1,.36,1) both',
        'count-up': 'fadeIn 0.5s ease-out both',
        /* ── Notificações ── */
        'notification-in': 'notificationIn 0.35s cubic-bezier(.22,1,.36,1) both',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideRight: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideLeft: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        zoomIn: {
          '0%': { transform: 'scale(0.85)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8' },
          '70%': { transform: 'scale(0.95)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        fadeUp: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-468px 0' },
          '100%': { backgroundPosition: '468px 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        pulseScale: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.04)' },
        },
        pageEnter: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pageExit: {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-8px)' },
        },
        drawerIn: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        drawerOut: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        pingOnce: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '75%': { transform: 'scale(1.8)', opacity: '0.4' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        progressFill: {
          '0%': { width: '0%' },
        },
        notificationIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.22,1,.36,1)',
        'out-expo': 'cubic-bezier(0.16,1,0.3,1)',
        'in-back': 'cubic-bezier(0.36,0,0.66,-0.56)',
        smooth: 'cubic-bezier(0.4,0,0.2,1)',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
        '400': '400ms',
        '600': '600ms',
      },
      backdropBlur: {
        xs: '2px',
        '2xl': '40px',
      },
      boxShadow: {
        'card-hover': '0 8px 24px -4px rgba(87,51,58,0.10)',
        'blue-glow': '0 4px 20px -4px rgba(183,110,121,0.35)',
        'cyan-glow': '0 4px 20px -4px rgba(201,169,110,0.35)',
        'emerald-glow': '0 4px 20px -4px rgba(127,163,138,0.3)',
        'inner-sm': 'inset 0 1px 3px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config
