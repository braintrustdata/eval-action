import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: "esm",
    outDir: "dist",
    target: "node24",
    minify: true,
    sourcemap: true,
    fixedExtension: false,
    deps: {
      alwaysBundle: [/.*/],
      onlyBundle: false,
    },
  },
});
