import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:5182',
        ws: true,
        changeOrigin: true,
      },
      '/api/tiktok': {
        target: 'http://localhost:5182',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tiktok/, ''),
      },
    },
  },
})
