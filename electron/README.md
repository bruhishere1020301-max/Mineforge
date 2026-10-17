# MineForge Studio — Desktop (Electron) Wrapper

This folder turns the MineForge Studio Next.js app into a Windows desktop
application. It contains **only** the Electron shell — the actual web app
lives in the repository root (`src/`).

| File | Purpose |
| --- | --- |
| `main.cjs` | Electron main process: window, bundled Next.js server lifecycle, secure IPC file API |
| `preload.cjs` | Context bridge that exposes `window.electronAPI` to the web app |
| `package.json` | Standalone npm package for the wrapper + `electron-builder` config |

The web app itself needs **no changes** to run inside Electron — it simply
detects `window.electronAPI` at runtime and switches from the browser
File System Access API to the native desktop file API (see
[How folder access works](#how-folder-access-works)).

---

## Quick try (dev)

Run from the **project root** (the folder containing `package.json`):

```bash
bun install     # install the web app dependencies
bun run dev     # Next.js dev server on http://localhost:3000 — keep it running
```

Then, in a **second terminal**, start the desktop shell:

```bash
cd electron
npm install     # downloads Electron (~100 MB, one time). bun install works too.
npm run start:dev
```

The MineForge Studio window opens and loads `http://localhost:3000`.
`start:dev` sets `ELECTRON_IS_DEV=1` (via `cross-env`, so it works on Windows
too), which tells `main.cjs` to connect to the dev server instead of spawning
the bundled production server.

> Tip: `npm start` (without `:dev`) runs the shell in **production mode** —
> it spawns the pre-built server from `../.next/standalone` on
> `http://127.0.0.1:3210`. Run `bun run build` in the project root first if
> you want to rehearse the packaged behaviour without building an installer.

---

## Build the .exe (production)

One command from the **project root** (Windows):

```bash
npm run dist:win
```

This runs, in order:

1. `npm run build` — `next build` → `.next/standalone` (+ `static` & `public`
   copied inside via `scripts/copy-standalone.mjs`),
2. `npm run db:template` — creates `electron/db-template.db`, an empty
   schema-only SQLite database that the app copies into its user-data folder
   on first launch (so a fresh install starts with a clean schema),
3. `npm install && npm run dist` inside `electron/` — `electron-builder --win`.

(Output lands in **`electron/release/`**):

- `MineForge Studio Setup 1.0.0.exe` — the **NSIS installer** (recommended
  for end users). It is *not* one-click: the user can pick the install
  directory, gets a desktop shortcut, and can uninstall from
  *Apps & Features* like a normal Windows program.
- `win-unpacked/MineForge Studio.exe` — the raw portable executable
  (no installer), handy for a quick smoke test.

What the installer bundles:

- the Electron shell (`main.cjs` + `preload.cjs`),
- the whole Next.js standalone server as `resources/app-server`
  (server, `.next/static`, `public` — via `extraResources`),
- the empty database template as `resources/db-template/mineforge.db`
  (seeded into `%APPDATA%\MineForge Studio\mineforge.db` on first launch).

**First launch after install:** no Node.js or other runtime needs to be
installed — `main.cjs` starts the bundled Next.js server automatically as a
child process on `http://127.0.0.1:3210` (reusing the Electron binary in
Node.js mode), waits until it answers (up to 30 s), then loads it in the
window. When you close the app, the server process is stopped too.

Cross-building from Linux/macOS to Windows is possible but fiddly
(RC editing/Code Signing); the simplest path is running the two commands
above **on a Windows machine**.

---

## How folder access works

The browser version of MineForge Studio uses the browser
**File System Access API** to write generated mods / shader packs into your
folders. In Electron the same features are provided natively:

1. **Native dialogs** — `dialog:selectDirectory` opens the real Windows
   folder picker ("Add project folder").
2. **Node `fs` over secure IPC** — the renderer never gets direct Node
   access. `main.cjs` runs with `contextIsolation: true` and
   `nodeIntegration: false`; `preload.cjs` exposes only the small
   `window.electronAPI` surface listed below.
3. **Path sandboxing** — every read/write is resolved with `path.resolve`
   and checked to stay **inside the folder you picked**. Anything that tries
   to escape it (`../..`, absolute paths, drive letters) is rejected with an
   error before touching the disk.
4. **Auto-detection** — the web app checks
   `window.electronAPI?.isElectron === true` at runtime and transparently
   uses the desktop API when present, falling back to the browser API
   otherwise. Nothing to configure.

### `window.electronAPI` reference

| Method | Resolves | Notes |
| --- | --- | --- |
| `selectDirectory()` | `{ path, name }` \| `null` | native folder picker; `null` = cancelled |
| `writeFiles(rootPath, files)` | `{ written }` | `files: { path, content }[]`, relative paths, parent dirs auto-created |
| `readTree(rootPath, maxDepth?)` | root tree node | default depth 5 (cap 10), ≤ ~2000 entries, skips `node_modules`, `.git`, `.gradle`, `build`, `.next`, `run` |
| `fileExists(rootPath, relPath)` | `boolean` | |
| `readFile(rootPath, relPath)` | `string` | UTF-8 text |
| `openPath(absPath)` | `true` | opens a folder in Explorer |
| `revealFile(absPath)` | `true` | shows a file in Explorer, selected |
| `isElectron` | `true` | feature flag for the web app |

`readTree` node shape:
`{ name, path (relative, `/`-separated), kind: 'dir' | 'file', size?, children? }`
— directories deeper than `maxDepth` simply omit `children`, and the root
node carries `truncated: true` when the 2000-entry cap was hit.

---

## Troubleshooting

**Port 3210 is already in use** — the bundled server binds `127.0.0.1:3210`.
If another app grabbed it, MineForge reuses anything already answering on
that port, which may not be what you want. Set a different port before
launching, e.g. `set MINEFORGE_PORT=3211` (Windows) or
`MINEFORGE_PORT=3211 npm start` (bash). You can also point the shell at any
running instance with `MINEFORGE_URL=http://localhost:3000`.

**Blank window / "gave up loading"** — the local server did not come up.
Check the console output of `electron .`: `[server] …` lines are the Next.js
server's own logs. Most common cause: `bun run build` was never run, so
`.next/standalone/server.js` does not exist (dev) or
`resources/app-server/server.js` is missing (packaged).

**Windows SmartScreen — "Windows protected your PC"** — the installer is
unsigned (no code-signing certificate), so Windows shows a warning on first
run. Click *More info* → *Run anyway*. Buying a code-signing certificate and
adding `"win": { "certificateFile": ... }` to the build config removes this.

**Antivirus flags the .exe** — false positives are common with
electron-builder output (NSIS + unsigned Electron binaries). Use the
official electron-builder releases, verify hashes, and add an exclusion for
`MineForge Studio.exe` in your AV. This is inherent to unsigned Electron
apps, not something specific to MineForge.

**Where is my data?** — the desktop edition keeps its SQLite database in
Electron's user-data folder (`%APPDATA%\MineForge Studio\mineforge.db` on
Windows), because the install folder under *Program Files* is not writable.
Set `DATABASE_URL` before launching to override (e.g. to reuse the dev
database `file:C:\path\to\db\custom.db`).

**Two windows won't open** — by design. The shell takes a single-instance
lock; launching the exe again just focuses the existing window.
