// Writes a real project package from a project of a library folder, with the product's own exporter.
// Usage: node e2e/make-package.ts <library> <cache> <projectId> <out.jagentchill>
import { exportProjectPackage } from "@jagentchill/storage";
import { filePackageSink, openDesktopStorage } from "@jagentchill/storage/desktop";

const [library, cache, projectId, out] = process.argv.slice(2);
const storage = await openDesktopStorage({ library, cache });
const summary = await exportProjectPackage(storage, projectId, await filePackageSink(out), { appVersion: "0.0.0", now_ms: Date.now() });
storage.close();
console.log(JSON.stringify(summary));
