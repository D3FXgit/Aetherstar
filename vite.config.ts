import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Renderer-only config. The Electron main/preload files are plain CommonJS
// and are loaded by Electron directly, so they are not part of this build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative paths so the built index.html works when loaded via file://
  base: './',
  root: '.',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/setupTests.ts'],
    globalSetup: ['./scripts/ensure-better-sqlite3.cjs'],
    // The suite is now large enough (200+ files, most of them jsdom) that
    // unbounded fork concurrency intermittently exhausts a worker's heap
    // ("Ineffective mark-compacts near heap limit"), which kills the fork and
    // reports every file it had in flight as failed -- all of which pass in
    // isolation. Bounding concurrency keeps total memory in range.
    // (`poolOptions.forks.maxForks` was the Vitest 3 key; Vitest 4 moved pool
    // options to top-level `test.maxWorkers` -- the old key is silently
    // ignored under v4, so it wasn't actually capping anything.)
    maxWorkers: 4,
  },
})
