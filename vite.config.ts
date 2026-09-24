import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    // Arena's browser preview uses per-session subdomains, not localhost.
    allowedHosts: ['.e2b.app'],
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/examples/')) return 'camera-controls';
          if (id.includes('/node_modules/three/')) return 'terrain-engine';
        },
      },
    },
  },
});
