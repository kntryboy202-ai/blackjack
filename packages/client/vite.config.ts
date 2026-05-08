// ABOUTME: Vite 6 configuration for the React 19 frontend.
// ABOUTME: Proxies /api and /socket.io paths to the Express backend server.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
    },
  },
});
