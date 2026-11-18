/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: {
    // Disabled: Tailwind's base reset (margins, box-sizing, etc.) would
    // subtly alter the existing Transport console's plain-CSS styling.
    // Utility classes (bg-cover, grid-cols-2, rounded-2xl, etc.) still work
    // fine without preflight -- only the global reset is skipped.
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};