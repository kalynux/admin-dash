/// <reference types="vitest/config" />
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Absolute, because this dashboard is only ever served from the root of
  // https://admin.wi-mall.com by nginx.
  //
  // It read './' until 2026-09-13, copied from the sibling dashboards — where a
  // RELATIVE base is correct because Capacitor serves their bundles off a device
  // filesystem with no origin. This app has no Capacitor and no native target at
  // all, so that value was inherited rather than chosen, and on the web it breaks
  // every deep link: index.html would reference './assets/index-abc.js', and a
  // browser hard-refreshing /dashboard/vendors/ID resolves that against the
  // current directory — requesting /dashboard/vendors/assets/index-abc.js, which
  // does not exist. nginx's SPA fallback then answers it with index.html, the
  // browser refuses to execute HTML as a module, and the page renders blank with
  // nothing in the server log to explain it.
  base: '/',
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
    // Vitest's default is 5 s, and this suite outgrew it: ~1750 tests across
    // ~116 files, each spinning up jsdom and rendering through the real
    // providers. Under full-suite load a `findBy*` that resolves in
    // milliseconds on its own can sit behind the event loop for longer than
    // that, so files passed alone and failed — a *different* one each run — in
    // the whole run.
    //
    // Raised rather than worked around per test: a flaky suite is worse than a
    // slow one, and a timeout that only fires under contention is measuring the
    // machine rather than the code.
    testTimeout: 20_000,
  },
});
