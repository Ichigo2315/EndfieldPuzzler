/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'endfield': {
          'green': '#A5D610',
          'blue': '#4DCCFF',
          'dark': '#1a1a2e',
          'darker': '#0f0f1a',
        }
      }
    },
  },
  plugins: [],
}
