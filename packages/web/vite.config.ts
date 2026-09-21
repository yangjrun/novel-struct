import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const API_TARGET = process.env['VITE_API_TARGET'] ?? 'http://localhost:3100';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
