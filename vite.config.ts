import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The browser talks gRPC-Web to Envoy through the dev server under /api (same origin, no CORS;
  // N68); Envoy of docker-compose.yml listens on 8080 and forwards to tinycad-core. `vite preview`
  // reuses this proxy (preview.proxy defaults to it): the e2e point it at Envoy of
  // docker-compose.e2e.yml with E2E_CORE_PORT (playwright.config.ts, N72).
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.E2E_CORE_PORT ?? '8080'}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  // planegcs (ADR 0016): the dep optimizer would bundle the Emscripten glue away from its .wasm;
  // the solver worker loads the file via `?url`.
  optimizeDeps: {
    exclude: ['@salusoft89/planegcs'],
  },
  // The solver worker is a module worker (top-level imports); the default 'iife' cannot code-split.
  worker: {
    format: 'es',
  },
});
