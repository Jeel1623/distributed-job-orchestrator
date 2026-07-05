/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#0f172a',      // slate-900
        darkCard: '#1e293b',    // slate-800
        darkBorder: '#334155',  // slate-700
        accentBlue: '#3b82f6',  // blue-500
        accentGreen: '#10b981', // emerald-500
        accentOrange: '#f59e0b',// amber-500
        accentRed: '#ef4444'    // red-500
      }
    },
  },
  plugins: [],
}
