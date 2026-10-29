const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  addReminderToCalendar: payload => ipcRenderer.invoke('calendar:add-reminder', payload),
  openAppConfig: () => ipcRenderer.invoke('app:open-config'),
  isMacApp: process.platform === 'darwin'
});
