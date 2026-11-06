import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("renderHostBridge", {
  send(channel: string, value: unknown) { if (channel === "render-host:message") ipcRenderer.send(channel, value); },
  onCommand(listener: (command: unknown) => void) { ipcRenderer.on("render-host:command", (_event, command) => listener(command)); },
  onShutdown(listener: () => void) { ipcRenderer.on("render-host:shutdown", () => listener()); },
});
