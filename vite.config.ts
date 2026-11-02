import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        launchpad: resolve(import.meta.dirname, "launchpad.html"),
      },
    },
  },
});
