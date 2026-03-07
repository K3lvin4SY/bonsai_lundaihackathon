import { contextBridge } from 'electron';

// This is where you will expose safe backend APIs to your React frontend
contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => console.log('pong from preload!'),
});