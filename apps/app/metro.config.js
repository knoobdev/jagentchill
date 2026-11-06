// The Electron platform flag: with JAGENTCHILL_TARGET=electron the web export prefers `name.electron.ts(x)` over
// `name.web.ts(x)` and `name.ts(x)`, which is how the desktop shell gets its own platform files. Without the flag
// this is Expo's default configuration, unchanged.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// tslib 1.x (a dependency of pdf-lib, the script PDF export) offers an `import` entry whose wrapper reads a default
// export its own UMD file does not have, so the bundle fails at run time. Its ES module file has every helper.
{
  const inner = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => (inner ?? context.resolveRequest)(context, moduleName === "tslib" ? "tslib/tslib.es6.js" : moduleName, platform);
}
if (process.env.JAGENTCHILL_TARGET === "electron") {
  const electron = ["electron.ts", "electron.tsx"];
  const inner = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const next = platform === "web" ? { ...context, sourceExts: [...electron, ...context.sourceExts.filter((ext) => !electron.includes(ext))] } : context;
    return (inner ?? context.resolveRequest)(next, moduleName, platform);
  };
  // The two targets never share a transform cache entry.
  config.cacheVersion = `${config.cacheVersion ?? ""}electron`;
}
module.exports = config;
