/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Ink / Paper / Rail — DESIGN_SYSTEM.md v2 Section 1. Replaces the
        // superseded stone/warm-50 system entirely. Ink is a warm near-black
        // (not stone-900), Paper is the base page background, Rail is the
        // hairline/border/dot-grid tone.
        ink: '#14110F',
        paper: '#FCFBF8',
        rail: '#E4E0D8',
        // Electric — new vivid, saturated, indigo-leaning royal blue accent.
        // Distinct from the default Tailwind blue scale already used
        // elsewhere (e.g. Nav's CTA, Button.astro accent variant).
        electric: '#3B4EFF',
      },
      fontFamily: {
        // Body/UI face — unchanged.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Display face — Space Grotesk replaces Plus Jakarta Sans.
        // DESIGN_SYSTEM.md v2 Section 2.
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Mono face (new) — eyebrow labels, flow-node captions, step counters.
        // DESIGN_SYSTEM.md v2 Section 2.
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
