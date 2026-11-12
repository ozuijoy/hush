import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Cloudflare Pages 的 SPA fallback；Netlify 由 netlify.toml 處理。 */
function cloudflarePages(): Plugin {
  return {
    name: 'hush-cloudflare-pages',
    apply: 'build',
    closeBundle() {
      if (process.env.BUILD_TARGET !== 'pages') return;
      writeFileSync(fileURLToPath(new URL('./dist/_redirects', import.meta.url)), '/* /index.html 200\n');
    },
  };
}

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  test: {
    root: projectRoot,
    include: ['tests/**/*.test.ts'],
  },
  plugins: [react(), tailwindcss(), cloudflarePages()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
});