import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Фронт — чистое SPA: все данные и AI идут через FastAPI (VITE_API_URL).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": dirname
    }
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node"
  }
})
