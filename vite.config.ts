import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({ base: './', resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, plugins: [react(), tailwindcss()], build: { rollupOptions: { output: { manualChunks: { motion: ['framer-motion'] } } } } })
