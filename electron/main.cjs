/**
 * MineForge Studio — Electron main process
 * ========================================
 *
 * Desktop wrapper around the MineForge Studio Next.js 16 app.
 *
 * Startup logic:
 *   1. process.env.MINEFORGE_URL set          → load that URL (override).
 *   2. Dev mode (NODE_ENV=development or
 *      ELECTRON_IS_DEV=1, i.e. `npm run start:dev`)
 *                                              → load http://localhost:3000
 *                                                (the `bun run dev` server).
 *   3. Production                              → spawn the bundled Next.js
 *                                                standalone server
 *                                                (`node server.js` on
 *                                                127.0.0.1:3210), wait until
 *                                                it answers, then load it.
 *                                                The child process is killed
 *                                                again when the app quits.
 *
 *   In production the server is spawned from `extraResources/app-server`
 *   (process.resourcesPath) when packaged; when running from the repo it is
 *   spawned from `<project root>/.next/standalone` (two levels up from this
 *   file), with cwd-based fallbacks.
 *
 * The renderer gets a small, hardened file API through preload.cjs
 * (contextIsolation ON, nodeIntegration OFF). Every path the renderer asks
 * to read or write is resolved with path.resolve() and verified to stay
 * inside the project folder the user picked — anything outside is rejected.
 */

'use strict';

/* Electron main/preload scripts MUST be CommonJS (no bundler runs over
 * them), so silence the repo-wide "no require()" lint rule for this file. */
/* eslint-disable @typescript-eslint/no-require-imports */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises; // promise-based fs for the IPC file API
const fsSync = require('fs'); // sync fs for cheap existence checks
const http = require('http'); // used to poll the local app server
const { spawn } = require('child_process');

/* ------------------------------ configuration ----------------------------- */

const DEV_APP_URL = 'http://localhost:3000'; // `bun run dev` dev server

const APP_SERVER_PORT = Number(process.env.MINEFORGE_PORT) || 3210;
const APP_SERVER_URL = `http://127.0.0.1:${APP_SERVER_PORT}`; // bundled server

const SERVER_BOOT_TIMEOUT_MS = 30 * 1000; // wait up to 30s for the server
const SERVER_POLL_INTERVAL_MS = 400; // retry the health poll every 400ms
const MAX_LOAD_RETRIES = 30; // page-load retries while a server is booting

const DEFAULT_TREE_DEPTH = 5; // fs:readTree default depth
const MAX_TREE_DEPTH = 10; // fs:readTree depth clamp
const MAX_TREE_ENTRIES = 2000; // fs:readTree total entry cap
// Directories that are noise in a generated mod / shader project tree
// (compared lower-case, so "Build"/"BUILD" are skipped on Windows too).
const IGNORED_DIRS = new Set(
  ['node_modules', '.git', '.gradle', 'build', '.next', 'run'].map((d) => d.toLowerCase())
);

/* --------------------------------- state ---------------------------------- */

let mainWindow = null; // the single BrowserWindow
let serverChild = null; // child process of the bundled Next.js server
let currentAppUrl = null; // URL currently loaded / being retried
let loadRetries = 0; // did-fail-load retry counter (server still booting)
let quitting = false; // set once the app starts shutting down

/* -------------------------------- logging --------------------------------- */

const log = (...args) => console.log('[mineforge]', ...args);
const logError = (...args) => console.error('[mineforge]', ...args);

/* ------------------------------ dev detection ----------------------------- */

function isDevMode() {
  return (
    process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1'
  );
}

/* ---------------------------- path safety guard --------------------------- */

/**
 * True when `abs` is `root` itself or located inside `root`
 * (i.e. it starts with "<root><path separator>").
 * Case-insensitive on Windows so `c:\mods` vs `C:\Mods` cannot bypass it.
 */
function isInsideRoot(root, abs) {
  if (abs === root) return true;
  const sep = path.sep;
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs;
  return a.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * SECURITY: resolve `relPath` against `rootPath` (the folder the user picked)
 * and make sure the result stays inside that root. `relPath` may be empty
 * (meaning the root itself). Throws otherwise — the IPC wrapper turns the
 * throw into a rejected promise in the renderer.
 */
function resolveInsideRoot(rootPath, relPath = '') {
  if (typeof rootPath !== 'string' || rootPath.trim() === '') {
    throw new Error('Invalid project root: expected a non-empty string.');
  }
  if (typeof relPath !== 'string') {
    throw new Error('Invalid file path: expected a string.');
  }
  const root = path.resolve(rootPath);
  const abs = relPath.trim() === '' ? root : path.resolve(root, relPath);
  if (!isInsideRoot(root, abs)) {
    throw new Error(
      `Access denied: "${relPath}" resolves outside the selected project folder.`
    );
  }
  return { root, abs };
}

/** Assert that a value is a non-empty string (input validation for IPC). */
function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid "${name}" argument: expected a non-empty string.`);
  }
}

/**
 * Register an ipcMain.handle with uniform error logging.
 * Errors are logged here and re-thrown so the renderer receives a rejected
 * promise with a real Error object.
 */
function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      logError(
        `IPC "${channel}" failed:`,
        err && err.message ? err.message : err
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  });
}

/* ------------------------- bundled app server (prod) ---------------------- */

/**
 * Figure out where the bundled Next.js standalone server lives.
 * Candidates, in order:
 *   1. Packaged .exe  → <resourcesPath>/app-server/server.js
 *      (electron-builder `extraResources` copies .next/standalone there)
 *   2. Repo checkout  → <project root>/.next/standalone/server.js
 *      (project root = two levels up from electron/main.cjs)
 *   3/4. cwd fallbacks → ./.next/standalone/server.js | ./app-server/server.js
 * Returns null when nothing exists (e.g. `bun run build` was never run).
 */
function resolveServerPaths() {
  const candidates = [];

  if (app.isPackaged && process.resourcesPath) {
    const resDir = path.join(process.resourcesPath, 'app-server');
    candidates.push({
      dir: resDir,
      script: path.join(resDir, 'server.js'),
      label: 'packaged extraResources',
    });
  }

  const projectRoot = path.resolve(__dirname, '..');
  candidates.push({
    dir: path.join(projectRoot, '.next', 'standalone'),
    script: path.join(projectRoot, '.next', 'standalone', 'server.js'),
    label: 'project .next/standalone',
  });

  const cwd = process.cwd();
  candidates.push({
    dir: path.join(cwd, '.next', 'standalone'),
    script: path.join(cwd, '.next', 'standalone', 'server.js'),
    label: 'cwd .next/standalone',
  });
  candidates.push({
    dir: path.join(cwd, 'app-server'),
    script: path.join(cwd, 'app-server', 'server.js'),
    label: 'cwd app-server',
  });

  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate.script)) return candidate;
    } catch {
      /* ignore unreadable candidate and try the next one */
    }
  }
  return null;
}

/**
 * Spawn the Next.js standalone server (`node server.js`) as a child process.
 *
 * We prefer this very Electron binary with ELECTRON_RUN_AS_NODE=1 so the
 * packaged app works on machines without a system Node.js; if that fails we
 * fall back to a plain `node` from PATH. Output is piped to our console.
 */
function spawnServerProcess(serverScript, serverDir) {
  const env = {
    ...process.env,
    PORT: String(APP_SERVER_PORT),
    HOSTNAME: '127.0.0.1', // bind to localhost only
    NODE_ENV: 'production',
    // Makes the Electron binary behave as a plain Node.js runtime.
    ELECTRON_RUN_AS_NODE: '1',
  };

  // Development .env files may point DATABASE_URL at a machine-specific path
  // which cannot exist on the user's PC. Unless DATABASE_URL is provided,
  // point Prisma at a SQLite file inside Electron's writable userData folder
  // (e.g. %APPDATA%\MineForge Studio\mineforge.db). process.env passed to the
  // child always wins over any .env file the server might load.
  if (!env.DATABASE_URL) {
    try {
      const userDataDir = app.getPath('userData');
      fsSync.mkdirSync(userDataDir, { recursive: true });
      const dbPath = path.join(userDataDir, 'mineforge.db');

      // First run: seed an empty database from the schema template that was
      // packaged via extraResources (built with `npm run db:template`), so the
      // app starts with a clean schema instead of crashing on missing tables.
      if (!fsSync.existsSync(dbPath)) {
        const templateCandidates = [];
        if (app.isPackaged && process.resourcesPath) {
          templateCandidates.push(path.join(process.resourcesPath, 'db-template', 'mineforge.db'));
        }
        const projectRoot = path.resolve(__dirname, '..');
        templateCandidates.push(path.join(projectRoot, 'electron', 'db-template.db'));
        templateCandidates.push(path.join(projectRoot, 'db-template.db'));
        for (const template of templateCandidates) {
          try {
            if (fsSync.existsSync(template)) {
              fsSync.copyFileSync(template, dbPath);
              log('first run — seeded empty database from template:', template, '→', dbPath);
              break;
            }
          } catch (err) {
            logError('could not copy the DB template:', err.message);
          }
        }
      }

      env.DATABASE_URL = 'file:' + dbPath;
      log('no DATABASE_URL set — using desktop database:', env.DATABASE_URL);
    } catch (err) {
      logError('could not prepare a default DATABASE_URL:', err.message);
    }
  }

  const launch = (command, label) => {
    log(`starting app server: ${command} "${serverScript}" (cwd: ${serverDir} — via ${label})`);
    const child = spawn(command, [serverScript], {
      cwd: serverDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const pipe = (chunk) =>
      chunk
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => log('[server]', line));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', (err) => logError(`app server (${label}) error:`, err.message));
    child.on('exit', (code, signal) => {
      if (serverChild === child) serverChild = null;
      log(`app server (${label}) exited (code=${code} signal=${signal})`);
    });
    return child;
  };

  // Preferred: the Electron binary itself running in Node.js mode.
  const child = launch(process.execPath, 'electron-as-node');

  // Fallback: a system `node` (only if spawning the binary itself failed).
  child.once('error', (err) => {
    if (serverChild !== child || quitting) return;
    logError('electron-as-node spawn failed, falling back to system `node`:', err.message);
    serverChild = launch('node', 'node');
  });

  serverChild = child;
  return child;
}

/** Promise-based "is something answering HTTP on this URL?". */
function pingServer(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const req = http.get(url, { timeout: 2500 }, (res) => {
        res.resume(); // drain the response
        done(true); // any HTTP status means the server is reachable
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => done(false));
    } catch {
      done(false);
    }
  });
}

/** Poll `url` every 400ms until it answers or `timeoutMs` elapses. */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    if (await pingServer(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Bring up the bundled Next.js server (production mode).
 * Returns true when http://127.0.0.1:3210 is answering.
 */
async function startBundledServer() {
  try {
    // Already running (leftover from a previous crash)? Reuse it.
    if (await pingServer(APP_SERVER_URL)) {
      log(`something already answers on ${APP_SERVER_URL} — reusing it`);
      return true;
    }

    const target = resolveServerPaths();
    if (!target) {
      logError('could not find the Next.js standalone server (server.js).');
      if (app.isPackaged && process.resourcesPath) {
        logError(`expected it at: ${path.join(process.resourcesPath, 'app-server', 'server.js')}`);
      }
      logError(
        `or at: ${path.join(path.resolve(__dirname, '..'), '.next', 'standalone', 'server.js')}`
      );
      logError('run "bun run build" in the project root first.');
      return false;
    }

    spawnServerProcess(target.script, target.dir);
    log(
      `waiting for the app server on ${APP_SERVER_URL} ` +
        `(poll every ${SERVER_POLL_INTERVAL_MS}ms, timeout ${SERVER_BOOT_TIMEOUT_MS / 1000}s)…`
    );
    return await waitForServer(APP_SERVER_URL, SERVER_BOOT_TIMEOUT_MS);
  } catch (err) {
    logError('failed to start the bundled app server:', err.message);
    return false;
  }
}

/** Stop the bundled server child (idempotent, safe to call repeatedly). */
function killServerProcess() {
  const child = serverChild;
  serverChild = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch (err) {
    logError('child.kill() failed:', err.message);
  }
  if (process.platform === 'win32' && child.pid) {
    // Belt & suspenders: on Windows a plain kill() is not recursive, so also
    // ask taskkill to take down the whole process tree.
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      /* best effort */
    }
  }
}

/** Synchronous variant for process.on('exit') (no event loop there). */
function killServerProcessSync() {
  const child = serverChild;
  serverChild = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    /* best effort */
  }
}

/* ------------------------------ app window -------------------------------- */

/** Minimal dark splash page shown while the local server is booting. */
function showLoadingScreen(message, hint) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeMessage = String(message || 'Loading…');
  const safeHint = String(hint || '');
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;background:#0a0d0b;color:#e8efe8;' +
    "font-family:'Segoe UI',system-ui,-apple-system,sans-serif}" +
    'body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}' +
    '.brand{font-size:26px;font-weight:700;letter-spacing:.4px}' +
    '.brand b{color:#4ade80}' +
    '.msg{font-size:15px;color:#b7c6b8}.hint{font-size:13px;color:#6f8271}' +
    '.spin{width:34px;height:34px;border-radius:50%;border:3px solid #1e2a20;' +
    'border-top-color:#4ade80;animation:spin .9s linear infinite}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '</style></head><body>' +
    '<div class="brand">Mine<b>Forge</b> Studio</div>' +
    '<div class="spin"></div>' +
    `<div class="msg">${safeMessage}</div>` +
    (safeHint ? `<div class="hint">${safeHint}</div>` : '') +
    '</body></html>';
  mainWindow
    .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    .catch(() => {});
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0d0b', // dark MineForge background (no white flash)
    autoHideMenuBar: true, // hide the default Electron menu bar
    show: false, // shown on first paint (ready-to-show)
    title: 'MineForge Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, // renderer is isolated from Node primitives
      nodeIntegration: false, // no Node in the web page itself
      sandbox: false, // preload script needs require('electron')
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  // A successful load resets the retry counter (e.g. after a dev reboot).
  mainWindow.webContents.on('did-finish-load', () => {
    loadRetries = 0;
  });

  // While the dev/bundled server is still booting, the first loads fail with
  // ERR_CONNECTION_REFUSED — quietly retry instead of showing an error page.
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _failedUrl, isMainFrame) => {
      if (!isMainFrame || !mainWindow || mainWindow.isDestroyed()) return;
      if (errorCode === -3) return; // ERR_ABORTED — replaced by a new navigation
      if (!currentAppUrl || quitting) return;
      if (loadRetries >= MAX_LOAD_RETRIES) {
        logError(`gave up loading ${currentAppUrl} (${errorCode} ${errorDescription})`);
        return;
      }
      loadRetries += 1;
      log(
        `page load failed (${errorCode} ${errorDescription}) — ` +
          `retry ${loadRetries}/${MAX_LOAD_RETRIES} in 1s`
      );
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || quitting) return;
        mainWindow.loadURL(currentAppUrl).catch(() => {});
      }, 1000);
    }
  );

  // Open external links (docs, provider pages…) in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch((err) => logError('openExternal failed:', err.message));
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/** Decide which URL to load (see the header comment) and load it. */
async function resolveAndLoadApp() {
  if (typeof process.env.MINEFORGE_URL === 'string' && process.env.MINEFORGE_URL.trim() !== '') {
    // 1. Explicit override — handy for pointing the shell at a remote build.
    currentAppUrl = process.env.MINEFORGE_URL.trim();
    log(`MINEFORGE_URL override — loading ${currentAppUrl}`);
  } else if (isDevMode()) {
    // 2. Dev mode — the Next.js dev server started with `bun run dev`.
    currentAppUrl = DEV_APP_URL;
    showLoadingScreen('Connecting to the dev server…', `${DEV_APP_URL} — start it with "bun run dev"`);
    log(`dev mode — loading ${currentAppUrl} (make sure "bun run dev" is running)`);
  } else {
    // 3. Production — boot the bundled Next.js standalone server.
    showLoadingScreen('Starting MineForge Studio…', `Booting the local app server on ${APP_SERVER_URL}`);
    const started = await startBundledServer();
    if (started) {
      currentAppUrl = APP_SERVER_URL;
    } else if (await pingServer(DEV_APP_URL)) {
      // Friendly fallback when someone runs `npm start` without a build.
      logError(`bundled server unavailable — falling back to the dev server at ${DEV_APP_URL}`);
      currentAppUrl = DEV_APP_URL;
    } else {
      logError(`the local server is not answering — loading ${APP_SERVER_URL} anyway (it will retry)`);
      currentAppUrl = APP_SERVER_URL;
    }
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.loadURL(currentAppUrl);
  } catch (err) {
    // The did-fail-load retry logic takes over — just log it.
    logError(`loadURL(${currentAppUrl}) failed:`, err && err.message ? err.message : err);
  }
}

/* ------------------------------ IPC file API ------------------------------ */

function registerIpcHandlers() {
  /* ----- native folder picker ------------------------------------------- */

  registerHandler('dialog:selectDirectory', async () => {
    const r = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths || r.filePaths.length === 0) return null;
    return {
      path: r.filePaths[0],
      name: path.basename(r.filePaths[0]),
    };
  });

  /* ----- write an array of files inside the picked root ------------------ */

  registerHandler('fs:writeFiles', async (rootPath, files) => {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Invalid "files" argument: expected a non-empty array.');
    }
    // Validate the whole batch first so we never half-write on bad input.
    const resolved = files.map((file) => {
      if (!file || typeof file !== 'object') {
        throw new Error('Invalid file entry: expected { path, content }.');
      }
      if (typeof file.path !== 'string' || file.path.trim() === '') {
        throw new Error('Invalid file entry: "path" must be a non-empty string.');
      }
      if (typeof file.content !== 'string') {
        throw new Error(`Invalid file entry "${file.path}": "content" must be a string.`);
      }
      const { root, abs } = resolveInsideRoot(rootPath, file.path); // security check
      return { abs, content: file.content };
    });
    const { root } = resolveInsideRoot(rootPath, '');
    const rootStat = await fs.stat(root).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      throw new Error(`Project folder does not exist: ${root}`);
    }
    for (const { abs, content } of resolved) {
      await fs.mkdir(path.dirname(abs), { recursive: true }); // ensure parent dirs
      await fs.writeFile(abs, content, 'utf8');
    }
    // WriteResult shape (matches the browser path) — the renderer reads
    // `written` and `errors`, so both must always be present.
    return { written: files.length, errors: [] };
  });

  /* ----- read a directory tree (nested JSON) ----------------------------- */

  registerHandler('fs:readTree', async (rootPath, maxDepth) => {
    const depth =
      Number.isFinite(maxDepth) && Number(maxDepth) > 0
        ? Math.min(Math.floor(Number(maxDepth)), MAX_TREE_DEPTH)
        : DEFAULT_TREE_DEPTH;

    const { root } = resolveInsideRoot(rootPath, '');
    const rootStat = await fs.stat(root).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      throw new Error(`Not a folder: ${root}`);
    }

    const state = { count: 0, truncated: false };

    /**
     * Walk `dirAbs` (a directory at tree level `level`) and return its
     * children as tree nodes. Unreadable folders come back as empty; the
     * total number of listed entries is capped at MAX_TREE_ENTRIES.
     */
    const walk = async (dirAbs, relPath, level) => {
      let dirents;
      try {
        dirents = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return []; // no permission / vanished — render as empty
      }
      // Folders first, then files, both alphabetical.
      dirents.sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        return aDir - bDir || a.name.localeCompare(b.name);
      });

      const children = [];
      for (const dirent of dirents) {
        if (state.count >= MAX_TREE_ENTRIES) {
          state.truncated = true;
          break;
        }
        // Skip build/dependency noise directories.
        if (dirent.isDirectory() && IGNORED_DIRS.has(dirent.name.toLowerCase())) {
          continue;
        }
        // `path` uses forward slashes so it works as a stable UI key
        // on every platform.
        const childRel = relPath === '' ? dirent.name : `${relPath}/${dirent.name}`;

        if (dirent.isDirectory()) {
          state.count += 1;
          const node = { name: dirent.name, path: childRel, kind: 'dir' };
          if (level + 1 < depth) {
            node.children = await walk(path.join(dirAbs, dirent.name), childRel, level + 1);
          }
          // Folders at the depth limit simply omit `children`.
          children.push(node);
        } else if (dirent.isFile()) {
          state.count += 1;
          let size;
          try {
            size = (await fs.stat(path.join(dirAbs, dirent.name))).size;
          } catch {
            /* file vanished between readdir and stat — omit size */
          }
          children.push({ name: dirent.name, path: childRel, kind: 'file', size });
        }
        // Symlinks and other special entries are skipped on purpose.
      }
      return children;
    };

    const tree = {
      name: path.basename(root) || root,
      path: '', // relative path of the root itself
      kind: 'dir',
      children: await walk(root, '', 0),
    };
    if (state.truncated) tree.truncated = true; // hit the 2000-entry cap
    return tree;
  });

  /* ----- existence check / read a text file ------------------------------- */

  registerHandler('fs:fileExists', async (rootPath, relPath) => {
    const { abs } = resolveInsideRoot(rootPath, relPath); // security check
    try {
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  });

  registerHandler('fs:readFile', async (rootPath, relPath) => {
    const { abs } = resolveInsideRoot(rootPath, relPath); // security check
    return fs.readFile(abs, 'utf8'); // rejects with Error if missing
  });

  /* ----- shell helpers (open folders in Explorer/Finder) ------------------ */

  registerHandler('fs:openPath', async (targetPath) => {
    assertNonEmptyString(targetPath, 'targetPath');
    const errorMessage = await shell.openPath(targetPath); // '' on success
    if (errorMessage) throw new Error(errorMessage);
    return true;
  });

  registerHandler('fs:revealFile', async (fullPath) => {
    assertNonEmptyString(fullPath, 'fullPath');
    shell.showItemInFolder(fullPath);
    return true;
  });
}

/* ------------------------------ app lifecycle ----------------------------- */

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // Another MineForge Studio window is already open — quit this one.
  log('MineForge Studio is already running — quitting this instance.');
  app.quit();
} else {
  // Focus the existing window when a second instance is launched.
  app.on('second-instance', () => {
    log('second instance requested — focusing the existing window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();
    resolveAndLoadApp().catch((err) =>
      logError('startup failed:', err && err.message ? err.message : err)
    );
  });

  // macOS convention: keep the app alive when all windows are closed.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      if (currentAppUrl) mainWindow.loadURL(currentAppUrl).catch(() => {});
    }
  });

  // Desktop tool: quit once the window is closed (except on macOS).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Make sure the bundled server child dies with the app.
  app.on('before-quit', () => {
    quitting = true;
    killServerProcess();
  });
  app.on('will-quit', () => {
    quitting = true;
    killServerProcess();
  });
  process.on('exit', () => killServerProcessSync());

  // Clean shutdown when the terminal sends SIGINT/SIGTERM.
  process.on('SIGINT', () => app.quit());
  process.on('SIGTERM', () => app.quit());
}
