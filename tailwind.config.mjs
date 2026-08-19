/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Warm off-white alt-section background — DESIGN_SYSTEM.md Section 1.
        // A real config-level token (not an arbitrary bracket value), used as bg-warm-50.
        warm: {
          50: '#FAF9F6',
        },
      },
      fontFamily: {
        // Body/UI face — unchanged, now actually wired to a loaded webfont (see Layout.astro).
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Display face — headlines and display numerals only. DESIGN_SYSTEM.md Section 2.
        display: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
