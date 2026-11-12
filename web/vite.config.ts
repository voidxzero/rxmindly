import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the same build works from the server and inside the Android app.
  base: './',
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
});
