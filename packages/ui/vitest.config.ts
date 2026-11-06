import { defineConfig } from "vitest/config";

// Component tests run the react-native-web implementation in jsdom, with the `.web` platform files, as the web build does.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      // The package's `main` is its CommonJS native build; the web build is what Metro picks for the browser.
      { find: /^react-native-svg$/, replacement: "react-native-svg/lib/module/ReactNativeSVG.web.js" },
      { find: /^react-native-safe-area-context$/, replacement: "react-native-safe-area-context/lib/module/index.js" },
    ],
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js", ".json"],
  },
  define: { __DEV__: "true" },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { pretendToBeVisual: true } },
    include: ["test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    server: { deps: { inline: true } },
  },
});
