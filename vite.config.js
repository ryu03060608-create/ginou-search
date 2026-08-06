import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' … どのURL階層（GitHub Pagesのサブパス等）でも動くよう相対パスにする
// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
})
