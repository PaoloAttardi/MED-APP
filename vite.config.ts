import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative so the same build works from Capacitor's https://localhost origin
  // and from any static path, without a rebuild.
  base: './',
  plugins: [react()],
})
