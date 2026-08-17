/// <reference types="vitest/config" />
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // 5173 is vendor-dash and 5174 is agency-dash; this dashboard takes 5175.
    // `strictPort` so a busy port fails loudly instead of silently moving —
    // wi-admin's CORS is an exact-match origin allowlist, and a dashboard that
    // quietly moved to 5176 would be blocked with no obvious cause.
    port: 5175,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
