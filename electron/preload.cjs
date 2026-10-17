/**
 * MineForge Studio — Electron preload script
 * ==========================================
 *
 * Runs in an isolated context (contextIsolation is ON, nodeIntegration is
 * OFF) and exposes exactly one tiny, validated bridge to the renderer:
 *
 *     window.electronAPI
 *
 * The web app feature-detects it (`window.electronAPI?.isElectron === true`)
 * to switch from the browser File System Access API to these native calls.
 * Every function returns a Promise that resolves with the main process
 * result or rejects with an Error (e.g. when a path tries to escape the
 * project folder the user picked).
 */

'use strict';

/* Electron main/preload scripts MUST be CommonJS (no bundler runs over
 * them), so silence the repo-wide "no require()" lint rule for this file. */
/* eslint-disable @typescript-eslint/no-require-imports */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Open a native "select folder" dialog.
   * Resolves { path: string, name: string } or null when cancelled.
   */
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  /**
   * Write files inside the picked root folder.
   * @param {string} rootPath - absolute path of the user-picked project folder
   * @param {{ path: string, content: string }[]} files - relative paths + UTF-8 content
   * Resolves { written: number }.
   */
  writeFiles: (rootPath, files) => ipcRenderer.invoke('fs:writeFiles', rootPath, files),

  /**
   * Read the directory tree under rootPath as nested JSON.
   * @param {string} rootPath - absolute path of the project folder
   * @param {number} [maxDepth] - default 5, capped at 10
   * Resolves the root node:
   *   { name, path: '', kind: 'dir', children: TreeNode[], truncated?: true }
   * TreeNode: { name, path (relative, '/'-separated), kind: 'dir'|'file',
   *             size?: number, children?: TreeNode[] }
   * (dirs deeper than maxDepth omit `children`; ~2000 entry cap → truncated)
   */
  readTree: (rootPath, maxDepth) => ipcRenderer.invoke('fs:readTree', rootPath, maxDepth),

  /**
   * Check whether a relative path exists inside the root folder.
   * Resolves boolean.
   */
  fileExists: (rootPath, relPath) =>
    ipcRenderer.invoke('fs:fileExists', rootPath, relPath),

  /**
   * Read a UTF-8 text file inside the root folder.
   * Resolves the file content as a string.
   */
  readFile: (rootPath, relPath) => ipcRenderer.invoke('fs:readFile', rootPath, relPath),

  /**
   * Open a folder (or a file with its default app) — e.g. the generated
   * mod project folder in Windows Explorer. Resolves true.
   */
  openPath: (p) => ipcRenderer.invoke('fs:openPath', p),

  /**
   * Reveal a file in Explorer / Finder with it selected. Resolves true.
   */
  revealFile: (p) => ipcRenderer.invoke('fs:revealFile', p),

  /** Always true in the desktop build — lets the web app feature-detect. */
  isElectron: true,
});
