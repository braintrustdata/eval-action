import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    quoteProps: "as-needed",
    jsxSingleQuote: false,
    bracketSpacing: true,
    bracketSameLine: true,
    arrowParens: "avoid",
    proseWrap: "always",
    htmlWhitespaceSensitivity: "css",
    endOfLine: "lf",
    sortPackageJson: false,
    ignorePatterns: [
      "**/dist/",
      "**/node_modules/",
      "**/coverage/",
      "README.md",
    ],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  test: {
    passWithNoTests: true,
  },
});
