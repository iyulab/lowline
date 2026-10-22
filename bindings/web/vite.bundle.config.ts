import { defineConfig } from 'vite'

// One file with Lit and formdown inside, for a page that loads the element with a single script tag.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'lowline-form.bundle.js' },
    outDir: 'dist/bundle',
    emptyOutDir: true,
  },
})
