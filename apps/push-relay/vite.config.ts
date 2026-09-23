import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

export default mergeConfig(
  basePackageConfig,
  defineConfig({
    pack: {
      entry: ["src/main.ts"],
      outDir: "dist",
      clean: true,
      sourcemap: true,
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:"),
        onlyBundle: false,
      },
    },
  }),
);
