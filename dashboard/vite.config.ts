import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 3200,
    allowedHosts: ['postarterial-holstered-beata.ngrok-free.dev'],
    proxy: {
      '/api': 'http://localhost:3100',
      '/auth': 'http://localhost:3100',
      '/a2a': 'http://localhost:3100',
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
