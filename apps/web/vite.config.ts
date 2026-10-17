import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5173 matches the server's WEB_ORIGIN and the Auth0 "Sword Web" allowed URLs.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
