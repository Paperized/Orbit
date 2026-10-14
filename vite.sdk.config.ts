import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'sdk/dist',
    emptyOutDir: true,
    lib: { entry: 'sdk/src/index.ts', name: 'Orbit', formats: ['iife', 'es'], fileName: format => format === 'es' ? 'orbit-sdk.mjs' : 'orbit-sdk.js' },
  },
});
