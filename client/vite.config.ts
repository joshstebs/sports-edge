import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// SportsEdge client — dev server on 5180, /api proxied to the backend (3100 by
// default). VITE_PROXY_TARGET overrides the target so verification can point at
// a local SSE stub.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5180,
      strictPort: true,
      host: true, // expose on the network (Tailscale) so Josh can reach it from his laptop/phone
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:3100',
          changeOrigin: true,
        },
      },
    },
  };
});
