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
  // OCCT (replicad-opencascadejs, spec 06 "Vite"): the dep optimizer would bundle the Emscripten
  // glue away from its .wasm; the worker loads the file via `?url` instead.
  optimizeDeps: {
    exclude: ['replicad-opencascadejs'],
  },
  // The OCCT worker is a module worker (top-level imports); the default 'iife' cannot code-split.
  worker: {
    format: 'es',
  },
});
