import { contextBridge } from "electron";

// The renderer gets only what is exposed here. Local database and sync
// bridges will be added to this object later.
contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
});
