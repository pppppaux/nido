import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// En local la API corre aparte (uvicorn en el 8100) y Vite le pasa /api. Publicada, la web
// está en GitHub Pages bajo /nido/ (BASE_PATH) y llama a la API por VITE_API_URL.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: { "/api": "http://127.0.0.1:8100" },
  },
});
