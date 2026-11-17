const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..', 'app');
let win = null;
let tray = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

app.setAppUserModelId('app.sakina.desktop'); // needed for Windows notifications

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    title: 'Sakina',
    icon: path.join(APP_DIR, 'img', 'icon.png'),
    backgroundColor: '#f6f3ec',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // reminder timers must fire while hidden in the tray
    },
  });
  win.loadFile(path.join(APP_DIR, 'index.html'));

  // links to the web open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  // closing the window keeps Sakina in the tray so prayer reminders still fire
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(APP_DIR, 'img', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Sakina');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Sakina', click: showWindow },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

// ---------- offline Quran recitation: files saved under the user's app data folder ----------
const quranRoot = () => path.join(app.getPath('userData'), 'quran');
const safeName = (s) => typeof s === 'string' && s.length > 0 && !s.includes('/') && !s.includes('\\') && !s.includes('..');
let quranCancel = false;
ipcMain.handle('quran:list', (e, reciter) => {
  const out = { dir: quranRoot(), files: [], bytes: 0 };
  if (!safeName(reciter)) return out;
  const dir = path.join(quranRoot(), reciter);
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!n.endsWith('.mp3')) continue;
    const size = fs.statSync(path.join(dir, n)).size;
    if (size > 0) { out.files.push(n); out.bytes += size; }
  }
  return out;
});
async function quranFetch(url, file) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  try {
    const res = await net.fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return false;
    fs.writeFileSync(file + '.part', buf);
    fs.renameSync(file + '.part', file);
    return true;
  } catch (_) { return false; }
}
ipcMain.handle('quran:download', async (e, reciter, items) => {
  if (!safeName(reciter) || !Array.isArray(items)) throw new Error('bad request');
  const dir = path.join(quranRoot(), reciter);
  fs.mkdirSync(dir, { recursive: true });
  quranCancel = false;
  let done = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < items.length && !quranCancel) {
      const it = items[i++];
      let ok = false;
      if (it && safeName(it.name)) {
        const file = path.join(dir, it.name);
        ok = fs.existsSync(file) && fs.statSync(file).size > 0;
        if (!ok) ok = await quranFetch(it.url, file);
        if (!ok && it.alt) ok = await quranFetch(it.alt, file);
      }
      done++; if (!ok) failed++;
      if (!e.sender.isDestroyed()) e.sender.send('quran:progress', { reciter, done, total: items.length, failed });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { done, failed, cancelled: quranCancel };
});
ipcMain.handle('quran:cancel', () => { quranCancel = true; });
ipcMain.handle('quran:remove', (e, reciter, names) => {
  if (!safeName(reciter)) return;
  const dir = path.join(quranRoot(), reciter);
  if (Array.isArray(names)) { for (const n of names) if (safeName(n)) fs.rmSync(path.join(dir, n), { force: true }); }
  else fs.rmSync(dir, { recursive: true, force: true });
});

app.whenReady().then(() => {
  createWindow();
  if (process.argv.includes('--hidden')) win.hide();
  createTray();
  app.on('activate', showWindow);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'win32') app.quit(); });
