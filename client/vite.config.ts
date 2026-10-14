import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Proxying /api keeps the browser on a single origin, so the dashboard works unchanged
    // from localhost or from another machine on the LAN. Without it the client has to embed
    // this machine's IP address, which breaks whenever the router hands out a new one, and
    // every request becomes cross-origin and needs a matching CORS entry.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true }
    }
  }
});
