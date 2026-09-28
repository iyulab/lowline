import { defineConfig } from 'vite'

// Tauri serves the dev build from a fixed port and reads the production build from dist/.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
