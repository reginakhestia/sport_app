import { defineConfig } from "vite";

// base: "./" makes the build work from any sub-path (GitHub Pages project sites,
// Netlify, etc.) which is what Telegram needs since it loads the app by URL.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
