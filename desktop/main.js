// 团子 Dango 桌面壳（Electron）。启动先显示选择页：自建服务器 / 加入服务器。
// 自建：在本进程内起 server.js，窗口连 https://localhost:<port>。
// 加入：窗口直接指向主机地址（同源加载对方页面，房间用现有邀请码流程加入）。
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createApp, ensureCert, getLanAddresses } from '../server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

let win = null;
let serverPort = 0;
const trustedOrigins = new Set(); // 允许跳过自签证书校验的 origin（本机 + 用户主动加入的主机）

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

async function startSelfHost() {
  if (serverPort) return { url: `https://localhost:${serverPort}/` }; // 已在跑
  const tls = await ensureCert(join(REPO, 'data'));
  const fingerprint = new X509Certificate(tls.cert).fingerprint256;
  const { server, adminToken } = await createApp({ tls });
  try {
    await listen(server, Number(process.env.PORT) || 3000);
  } catch {
    await listen(server, 0);
  }
  serverPort = server.address().port;
  trustedOrigins.add(`https://localhost:${serverPort}`);
  const lan = getLanAddresses(serverPort, networkInterfaces(), 'https').map((x) => x.url);
  console.log('\n团子 Dango（自建服务器）已启动');
  console.log(`管理员口令: ${adminToken}`);
  console.log(`本机: https://localhost:${serverPort}`);
  for (const url of lan) console.log(`局域网: ${url}`);
  console.log(`证书指纹(SHA-256): ${fingerprint}\n`);
  return { url: `https://localhost:${serverPort}/`, lan, fingerprint };
}

function normalizeHost(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    if (!u.port) u.port = '3000';
    return u;
  } catch {
    return null;
  }
}

ipcMain.handle('dango:self-host', async () => {
  const info = await startSelfHost();
  win.loadURL(info.url);
  return info;
});

ipcMain.handle('dango:join', async (_event, address) => {
  const u = normalizeHost(address);
  if (!u) throw new Error('地址无效，示例：192.168.1.23:3000 或 dango.local:3000');
  trustedOrigins.add(u.origin);
  win.loadURL(`${u.origin}/`);
  return { url: `${u.origin}/` };
});

// 只信任本机与用户主动选择加入的主机的自签证书
app.on('certificate-error', (event, webContents, url, error, cert, callback) => {
  let origin = '';
  try { origin = new URL(url).origin; } catch { /* ignore */ }
  if (origin && trustedOrigins.has(origin)) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 360,
    minHeight: 480,
    title: '团子 Dango',
    backgroundColor: '#14171a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(HERE, 'launcher.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.setName('团子 Dango');

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
