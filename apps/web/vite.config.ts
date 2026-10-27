import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @hearth/contracts 是 workspace TS 源码包（exports 指向 src/index.ts），
// Vite 需要显式 alias 才能稳定解析并转译它。
const contractsEntry = new URL('../../packages/contracts/src/index.ts', import.meta.url)
  .pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hearth/contracts': contractsEntry,
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 同源 /api 代理到本地 Hearth server；changeOrigin 关闭以保留
      // Host/Cookie，会话 cookie 由 server 下发并在同源下生效。
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
