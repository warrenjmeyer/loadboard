import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite is the build tool. In dev it serves your files straight to the browser;
// `npm run build` compiles everything into a plain static ./dist folder --
// which is exactly what Azure Storage static website hosting wants.
//
// base: './' makes the built index.html reference its assets with relative
// paths. Absolute paths ("/assets/...") also work on Azure static websites,
// but relative keeps the build portable if you ever serve it from a subfolder.
export default defineConfig({
  plugins: [react()],
  base: './',
})
