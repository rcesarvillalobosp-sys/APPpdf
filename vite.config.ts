/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Política de seguridad (CSP) como <meta> en el HTML final. Cloudflare Pages ya la
 * envía como cabecera (public/_headers), pero GitHub Pages no permite cabeceras
 * propias, así que también va en el HTML. `connect-src 'self'` impide que la página
 * envíe documentos a otros dominios. Solo en build: el servidor de desarrollo
 * necesita scripts en línea.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
    ],
  };
}

export default defineConfig({
  // En GitHub Pages la app vive en /nombre-del-repo/; el workflow define BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss(), cspMeta()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['tests/setup.ts'],
  },
});
