import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// framer-motion in its own chunk, loaded with the simulator. Rollup pulls a manual chunk's unassigned dependencies into it,
// so React gets a chunk of its own; before, React sat inside `motion` and the landing preloaded all of framer-motion.
const vendorChunk = (id: string) => /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id) ? 'motion'
  : /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined

export default defineConfig({ base: './', resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, plugins: [react(), tailwindcss()], build: {
  // ponytail: the only chunk over 500 kB is deviceModel, which is three.js core (~560 kB) and is already loaded on demand by
  // deviceStage.ts. 600 keeps the warning useful for any new chunk; lower it if three.js is ever swapped or split.
  chunkSizeWarningLimit: 600,
  rollupOptions: { output: { manualChunks: vendorChunk } } } })
