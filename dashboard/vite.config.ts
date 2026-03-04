import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3200,
    proxy: {
      '/api': 'http://localhost:3100',
      '/auth': 'http://localhost:3100',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
});
