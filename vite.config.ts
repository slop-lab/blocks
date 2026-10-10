import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export const config = defineConfig({
  root: "app",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env["BACKEND_URL"] ?? "http://127.0.0.1:3000" },
      "/collaboration": { target: process.env["BACKEND_URL"] ?? "http://127.0.0.1:3000", ws: true },
    },
  },
})

export default config
