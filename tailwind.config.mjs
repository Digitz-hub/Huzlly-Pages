/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        
        ink: '#14110F',
        paper: '#FFFFFF',
        rail: '#E4E0D8',
        
        electric: '#3B4EFF',

        blue: {
          50: '#F5F6FF',
          100: '#E7EAFF',
          200: '#CCD1FF',
          300: '#ADB5FF',
          400: '#8591FF',
          500: '#5E6EFF',
          600: '#3B4EFF',
          700: '#3242D9',
          800: '#2937B2',
          900: '#202B8C',
        },
      },
      fontFamily: {
        
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        
        // Inter — used on headings via the `font-display` class
        display: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        
        mono: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
