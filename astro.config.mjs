import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://huzlly-pages.pages.dev', // Custom domain aane par update kar sakte hain
  integrations: [sitemap()],
});
