// Select the headless renderer before loading main.ts: the normal desktop bootstrap owns user data,
// the single-instance lock, tray, updater and user windows, none of which belong to a render child.
const child = process.argv.includes("--render-host") ? "./render-host-main.cjs" : "./main.cjs";
require(child);
