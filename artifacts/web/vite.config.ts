import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// PORT 是選用的：沒設就用預設埠。
// 先前這裡在缺少 PORT 時直接拋錯，那是「平台一定會注入 PORT」的前提；
// 現在本機直接跑 vite 或由 netlify dev 代管都不會注入，拋錯只會擋住開發。
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // 前端一律呼叫相對路徑 /api/...（baseUrl 在 codegen 時就寫死，
    // 見 lib/api-spec/orval.config.ts），所以開發時要把它轉給本機的 Express。
    //
    // 為什麼不靠 `netlify dev` 代勞：它在 Windows 上需要建立 symlink 才能把
    // 函式的依賴放到位，而那需要開發者模式或管理員權限，預設會 EPERM 失敗。
    // 這個 proxy 沒有那個前提，任何機器都能直接跑。
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
