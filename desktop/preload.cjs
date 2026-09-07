// 只给启动页暴露两个动作，其余保持隔离。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dango', {
  selfHost: () => ipcRenderer.invoke('dango:self-host'),
  join: (address) => ipcRenderer.invoke('dango:join', address),
});
