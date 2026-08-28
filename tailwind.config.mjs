/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        
        ink: '#14110F',
        paper: '#FCFBF8',
        rail: '#E4E0D8',
        
        electric: '#3B4EFF',
      },
      fontFamily: {
        
        sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        
        // Poppins — used on headings via the `font-display` class
        display: ['"Poppins"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        
        mono: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
