/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy:  { DEFAULT: '#0E1C36', 700: '#16294C', 600: '#1E3a63' },
        brass: { DEFAULT: '#C39A4D', light: '#E3C57E' },
        paper: '#F7F5F0',
        ink:   '#1B2433',
      },
      fontFamily: {
        serif: ['"Century Schoolbook"', 'Georgia', 'serif'],
        sans:  ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
