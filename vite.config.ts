import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const webPort = Number(process.env.LUMIPATH_WEB_PORT ?? 5317);
const apiPort = Number(process.env.LUMIPATH_API_PORT ?? 8938);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'animal-island-ui': fileURLToPath(
        new URL('./src/lib/animal-island-ui.tsx', import.meta.url),
      ),
    },
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
