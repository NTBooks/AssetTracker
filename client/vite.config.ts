import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ["assets.chaincart.io"],
    proxy: { "/api": "http://localhost:5174" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
