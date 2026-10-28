// Companion — Electron main process.
// Owns the Studio window, the transparent desktop overlay where companions live,
// the tray menu, the companion library on disk, and .companion package import/export.
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, screen, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { unzipSync, strFromU8 } = require('fflate');

const MODEL_CDN = 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';
const SELFTEST = process.argv.includes('--selftest');
const START_HIDDEN = process.argv.includes('--hidden');
const PRELOAD = path.join(__dirname, 'preload.js');
const ID_RE = /^[a-z0-9-]{1,48}$/;
const MAX_ENTRY = 64 * 1024 * 1024;
const SIZES = [['Small', 110], ['Medium', 150], ['Large', 200], ['Extra large', 260]];

protocol.registerSchemesAsPrivileged([
  { scheme: 'companion-res', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// The cutout model is shared between normal runs and self-tests so it downloads once.
const modelCacheDir = path.join(app.getPath('appData'), 'Companion', 'model-cache');
if (SELFTEST) app.setPath('userData', path.join(app.getPath('appData'), 'Companion-selftest'));
const selftestOut = process.env.SELFTEST_OUT || path.join(app.getPath('temp'), 'companion-selftest');

let studioWin = null;
let overlayWin = null;
let tray = null;
let keyHook = null;
let state = { active: [], size: {}, follow: {} };

// ---------- library + state ----------
const libDir = () => path.join(app.getPath('userData'), 'companions');
const statePath = () => path.join(app.getPath('userData'), 'state.json');
const companionDir = (id) => path.join(libDir(), id);
const hasCompanion = (id) => ID_RE.test(id) && fs.existsSync(path.join(companionDir(id), 'manifest.json'));

function loadState() {
  try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) }; } catch { /* first run */ }
  state.active = state.active.filter(hasCompanion);
}

function saveState() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function readManifest(id) {
  return JSON.parse(fs.readFileSync(path.join(companionDir(id), 'manifest.json'), 'utf8'));
}

function listLibrary() {
  if (!fs.existsSync(libDir())) return [];
  return fs.readdirSync(libDir()).filter(hasCompanion).map((id) => ({
    id,
    name: readManifest(id).name,
    active: state.active.includes(id),
  }));
}

function companionInfo(id) {
  const manifest = readManifest(id);
  return {
    id,
    manifest,
    baseUrl: pathToFileURL(companionDir(id)).href + '/',
    size: state.size[id] || manifest.display?.size || 150,
    follow: !!state.follow[id],
  };
}

// Packages are zip files. Only the files a companion needs are kept, so a
// package from someone else can't drop arbitrary files into the library.
function importPackageBytes(bytes) {
  let files;
  try {
    files = unzipSync(new Uint8Array(bytes), { filter: (f) => f.originalSize <= MAX_ENTRY });
  } catch {
    throw new Error('This file is not a Companion package.');
  }
  if (!files['manifest.json']) throw new Error('This package is missing its manifest.');
  let m;
  try { m = JSON.parse(strFromU8(files['manifest.json'])); } catch { throw new Error('The package manifest is damaged.'); }
  const framed = !!m.frame || (Array.isArray(m.actions) && m.actions.every((a) => a && a.frame));
  if (m.format !== 'companion/1' || typeof m.name !== 'string' || !Array.isArray(m.actions) || !framed) {
    throw new Error('This package was made for a different version of Companion.');
  }
  if (!ID_RE.test(m.uid || '')) throw new Error('This package has an invalid id.');

  const keep = { 'manifest.json': files['manifest.json'] };
  for (const extra of ['sprite.png', 'thumb.png']) if (files[extra]) keep[extra] = files[extra];
  for (const a of m.actions) {
    if (!ID_RE.test(a.id || '') || a.sheet !== `sheets/${a.id}.webp` || !files[a.sheet]) {
      throw new Error(`The package is missing the "${a.id}" animation.`);
    }
    keep[a.sheet] = files[a.sheet];
  }

  const dir = companionDir(m.uid);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'sheets'), { recursive: true });
  for (const [name, data] of Object.entries(keep)) fs.writeFileSync(path.join(dir, name), data);
  return m.uid;
}

function importFromPath(file) {
  const id = importPackageBytes(fs.readFileSync(file));
  activate(id);
  return { id, name: readManifest(id).name };
}

async function pickAndImport() {
  const parent = studioWin && !studioWin.isDestroyed() ? studioWin : undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: 'Import a Companion package',
    filters: [{ name: 'Companion package', extensions: ['companion'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  try {
    return importFromPath(filePaths[0]);
  } catch (err) {
    dialog.showErrorBox('Could not import package', err.message);
    return null;
  }
}

function activate(id) {
  if (!state.active.includes(id)) state.active.push(id);
  saveState();
  if (!overlayWin) createOverlay();
  else overlayWin.webContents.send('overlay:add', companionInfo(id));
  buildTray();
}

function deactivate(id) {
  state.active = state.active.filter((x) => x !== id);
  saveState();
  overlayWin?.webContents.send('overlay:remove', id);
  buildTray();
}

async function deleteCompanion(id) {
  const name = readManifest(id).name;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete companion',
    message: `Delete ${name} from your library?`,
    detail: 'Any .companion package file you saved stays where it is.',
  });
  if (response !== 0) return;
  deactivate(id);
  fs.rmSync(companionDir(id), { recursive: true, force: true });
  buildTray();
}

// ---------- windows ----------
function openStudio() {
  if (studioWin) {
    if (studioWin.isMinimized()) studioWin.restore();
    studioWin.show();
    studioWin.focus();
    return;
  }
  studioWin = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 1020,
    minHeight: 700,
    title: 'Companion Studio',
    backgroundColor: '#F4F1EB',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  studioWin.setMenuBarVisibility(false);
  studioWin.loadFile(path.join(__dirname, 'src', 'studio', 'index.html'));
  studioWin.once('ready-to-show', () => studioWin.show());
  if (SELFTEST) pipeConsole(studioWin, 'studio');
  studioWin.on('closed', () => {
    studioWin = null;
    if (!state.active.length && !SELFTEST) app.quit();
  });
}

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  overlayWin = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'Companion',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(__dirname, 'src', 'overlay', 'index.html'));
  overlayWin.once('ready-to-show', () => overlayWin.showInactive());
  if (SELFTEST) pipeConsole(overlayWin, 'overlay');
  overlayWin.on('closed', () => { overlayWin = null; });
}

function fitOverlay() {
  if (!overlayWin) return;
  overlayWin.setBounds(screen.getPrimaryDisplay().workArea);
}

// ---------- tray ----------
function loginOptions() {
  return app.isPackaged
    ? { args: ['--hidden'] }
    : { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
    tray.setToolTip('Companion');
    tray.on('click', openStudio);
  }
  const lib = listLibrary();
  const startsWithWindows = app.getLoginItemSettings(loginOptions()).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Companion Studio', click: openStudio },
    { label: 'Import package…', click: pickAndImport },
    { type: 'separator' },
    ...(lib.length
      ? lib.map((c) => ({
          label: c.name,
          submenu: [
            {
              label: 'On my desktop',
              type: 'checkbox',
              checked: c.active,
              click: (item) => (item.checked ? activate(c.id) : deactivate(c.id)),
            },
            { label: 'Delete from library…', click: () => deleteCompanion(c.id) },
          ],
        }))
      : [{ label: 'No companions yet', enabled: false }]),
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: startsWithWindows,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, ...loginOptions() }),
    },
    { label: 'Quit Companion', click: () => app.quit() },
  ]));
}

// ---------- cutout model cache ----------
// companion-res://imgly/<file> serves the background-removal model from a local
// cache, fetching each file from IMG.LY's CDN the first time it's needed.
function setupModelProtocol() {
  protocol.handle('companion-res', async (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const headers = {
      'access-control-allow-origin': '*',
      'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    };
    if (!/^[\w.\-/]+$/.test(rel) || rel.split('/').includes('..')) return new Response(null, { status: 400, headers });
    const file = path.join(modelCacheDir, rel);
    try {
      if (!fs.existsSync(file)) {
        const res = await net.fetch(MODEL_CDN + rel);
        if (!res.ok) return new Response(null, { status: res.status, headers });
        const buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.part`;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, file);
      }
      return new Response(await fs.promises.readFile(file), { headers });
    } catch {
      return new Response(null, { status: 502, headers });
    }
  });
}

// ---------- IPC ----------
function safeFileName(name) {
  return (String(name || 'companion').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'companion').slice(0, 60);
}

ipcMain.handle('pkg:save', async (event, bytes, suggested) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Companion package',
    defaultPath: path.join(app.getPath('downloads'), `${safeFileName(suggested)}.companion`),
    filters: [{ name: 'Companion package', extensions: ['companion'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
});

ipcMain.handle('pkg:import', (_event, bytes) => {
  const id = importPackageBytes(bytes);
  activate(id);
  return { id, name: readManifest(id).name };
});

ipcMain.handle('pkg:pick-import', () => pickAndImport());
ipcMain.handle('lib:list', () => listLibrary());
ipcMain.handle('overlay:get-active', () => state.active.map(companionInfo));
ipcMain.on('overlay:set-ignore', (_event, ignore) => overlayWin?.setIgnoreMouseEvents(!!ignore, { forward: true }));
ipcMain.on('app:open-studio', () => openStudio());

// Keyboard Buddy: a global hook that only tells the desktop client *that* you typed
// (never which key). It runs only while an active companion wants it.
function setTypingHook(on) {
  if (on && !keyHook) {
    try {
      const { uIOhook } = require('uiohook-napi');
      let last = 0;
      uIOhook.on('keydown', () => {
        const now = Date.now();
        if (now - last < 60) return;
        last = now;
        overlayWin?.webContents.send('overlay:typing');
      });
      uIOhook.start();
      keyHook = uIOhook;
    } catch (err) {
      console.warn('Keyboard activity is unavailable:', err.message);
    }
  } else if (!on && keyHook) {
    keyHook.removeAllListeners('keydown');
    keyHook.stop();
    keyHook = null;
  }
}
ipcMain.on('overlay:want-typing', (_event, on) => setTypingHook(!!on));
app.on('will-quit', () => setTypingHook(false));

ipcMain.on('overlay:menu', (_event, { id, actions, size, follow }) => {
  if (!overlayWin || !hasCompanion(id)) return;
  const send = (cmd, arg) => overlayWin?.webContents.send('overlay:command', { id, cmd, arg });
  Menu.buildFromTemplate([
    { label: readManifest(id).name, enabled: false },
    { type: 'separator' },
    { label: 'Do…', submenu: actions.map((a) => ({ label: a.name, click: () => send('play', a.id) })) },
    {
      label: 'Size',
      submenu: SIZES.map(([label, px]) => ({
        label,
        type: 'radio',
        checked: size === px,
        click: () => { state.size[id] = px; saveState(); send('size', px); },
      })),
    },
    {
      label: 'Follow my cursor',
      type: 'checkbox',
      checked: !!follow,
      click: (item) => { state.follow[id] = item.checked; saveState(); send('follow', item.checked); },
    },
    { type: 'separator' },
    { label: 'Send home (hide)', click: () => deactivate(id) },
    { label: 'Open Companion Studio', click: openStudio },
  ]).popup({ window: overlayWin });
});

// ---------- self-test hooks (npm run selftest) ----------
function pipeConsole(win, tag) {
  win.webContents.on('console-message', (...args) => {
    const msg = args[0]?.message ?? args[2];
    console.log(`[${tag}] ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => console.log(`[${tag}] renderer gone`, details));
}

ipcMain.handle('selftest:info', () => {
  if (!SELFTEST) return { on: false };
  const img = process.env.SELFTEST_IMAGE;
  return { on: true, image: img ? fs.readFileSync(img) : null };
});

ipcMain.handle('selftest:capture', async (event, name) => {
  if (!SELFTEST) return false;
  const win = name.startsWith('overlay') ? overlayWin : BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const img = await win.webContents.capturePage();
  fs.mkdirSync(selftestOut, { recursive: true });
  fs.writeFileSync(path.join(selftestOut, `${name}.png`), img.toPNG());
  console.log(`[selftest] captured ${name}`);
  return true;
});

ipcMain.on('selftest:done', (_event, ok) => {
  console.log(`[selftest] finished: ${ok ? 'PASS' : 'FAIL'}`);
  setTimeout(() => app.exit(ok ? 0 : 1), 300);
});

// ---------- startup ----------
// Dev: `electron . --shot=src/dev/bird.html,name` renders a page to .selftest/name.png.
const SHOT = process.argv.find((a) => a.startsWith('--shot='));
const gotLock = SHOT || SELFTEST || app.requestSingleInstanceLock();
if (SHOT) {
  app.whenReady().then(async () => {
    setupModelProtocol();
    const [page, name] = SHOT.slice(7).split(',');
    const win = new BrowserWindow({
      width: 1880, height: 1000, show: true, backgroundColor: '#dfe5ec',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
    });
    pipeConsole(win, 'shot');
    // Dev pages may save generated assets into the project.
    ipcMain.handle('dev:save', (_e, rel, bytes) => {
      const out = path.join(__dirname, rel);
      if (!out.startsWith(path.join(__dirname, 'assets'))) throw new Error('dev:save only writes under assets/');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(bytes));
    });
    const [file, query] = page.split('?');
    await win.loadURL(pathToFileURL(path.join(__dirname, file)).href + (query ? `?${query}` : ''));
    for (let i = 0; i < 1800 && win.getTitle() !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage();
    fs.mkdirSync(selftestOut, { recursive: true });
    fs.writeFileSync(path.join(selftestOut, `${name}.png`), img.toPNG());
    console.log(`[shot] wrote ${name}.png (title: ${win.getTitle()})`);
    app.exit(0);
  });
} else if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = argv.find((a) => a.toLowerCase().endsWith('.companion'));
    if (file) {
      try { importFromPath(file); } catch (err) { dialog.showErrorBox('Could not import package', err.message); }
    } else {
      openStudio();
    }
  });

  app.whenReady().then(() => {
    if (SELFTEST) {
      setTimeout(() => { console.log('[selftest] timed out'); app.exit(2); }, 6 * 60 * 1000);
      fs.rmSync(libDir(), { recursive: true, force: true });
      fs.rmSync(statePath(), { force: true });
    }
    setupModelProtocol();
    loadState();
    buildTray();
    createOverlay();
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', fitOverlay);
    screen.on('display-removed', fitOverlay);

    const file = process.argv.find((a) => a.toLowerCase().endsWith('.companion'));
    if (file) {
      try { importFromPath(file); } catch (err) { dialog.showErrorBox('Could not import package', err.message); }
    }
    if (SELFTEST || !START_HIDDEN || !state.active.length) openStudio();
  });

  // Companions keep living in the tray after the Studio closes.
  app.on('window-all-closed', () => {});
}
