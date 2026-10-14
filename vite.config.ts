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
  // OCCT (replicad-opencascadejs, spec 06 "Vite") and planegcs (ADR 0016): the dep optimizer
  // would bundle the Emscripten glue away from its .wasm; the workers load the file via `?url`.
  optimizeDeps: {
    exclude: ['replicad-opencascadejs', '@salusoft89/planegcs'],
  },
  // Dev serves TypeScript transformed for 'esnext', so `using` (kernel-occt) reached the browser
  // as is and Safari, which lacks it, could not load the OCCT worker. Lower newer syntax in dev
  // too; the production build already does (build.target).
  oxc: {
    target: 'es2022',
  },
  // The OCCT and solver workers are module workers (top-level imports); the default 'iife' cannot code-split.
  worker: {
    format: 'es',
  },
});
