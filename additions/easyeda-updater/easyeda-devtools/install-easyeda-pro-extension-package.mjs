#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { WebSocket } = require('ws');
const JSZip = require('jszip');
const scriptDir = dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.EASYEDA_REMOTE_DEBUGGING_PORT || 9222);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((arg) => arg !== '--dry-run');
const targetPath = resolve(positional[0] || '');
const uuid = positional[1] || '64651de62a944308a56e3b42eb2cb248';
const backupDir = resolve(positional[2] || join(scriptDir, 'backups'));

if (!targetPath) {
  console.error('Usage: node install-easyeda-pro-extension-package.mjs <path-to.eext> [extension-uuid] [backup-dir] [--dry-run]');
  process.exit(2);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function call(ws, method, params = {}) {
  const id = call.nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== id) return;
      ws.off('message', onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolveCall(message.result);
    };
    ws.on('message', onMessage);
  });
}
call.nextId = 1;

async function connectEasyEdaPage() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === 'page' && /pro\.easyeda\.com\/editor/.test(target.url))
    ?? targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No EasyEDA page target found. Start EasyEDA with --remote-debugging-port=9222.');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.once('open', resolveOpen);
    ws.once('error', reject);
  });
  return ws;
}

async function evaluate(ws, expression, timeout = 60_000) {
  const result = await call(ws, 'Runtime.evaluate', {
    expression: `Promise.resolve((async () => { return (${expression}); })())`,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  return result.result.value;
}

function asText(buffer) {
  return Buffer.from(buffer).toString('utf8');
}

function guessType(path) {
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function rootNameFromZip(files) {
  const roots = new Set(files.map((path) => path.split('/')[0]).filter(Boolean));
  return roots.size === 1 ? [...roots][0] : '';
}

async function buildPayload(eextPath) {
  const archive = await readFile(eextPath);
  const zip = await JSZip.loadAsync(archive);
  const filePaths = Object.keys(zip.files);
  const rootName = rootNameFromZip(filePaths);
  const stripRoot = (path) => rootName && path.startsWith(`${rootName}/`) ? path.slice(rootName.length + 1) : path;

  const entries = [];
  let config = null;
  for (const rawPath of filePaths) {
    const normalizedPath = stripRoot(rawPath).replaceAll('\\', '/');
    if (!normalizedPath) continue;
    const directory = zip.files[rawPath].dir;
    const data = directory ? Buffer.alloc(0) : await zip.files[rawPath].async('nodebuffer');
    if (normalizedPath === 'extension.json') config = JSON.parse(asText(data));
    entries.push({
      path: normalizedPath,
      name: basename(normalizedPath),
      type: guessType(normalizedPath),
      base64: data.toString('base64'),
      size: data.length,
      directory,
    });
  }

  if (!config) throw new Error('extension.json was not found in the .eext package.');
  return {
    eextFileName: basename(eextPath),
    fileSize: archive.length,
    config,
    archiveBase64: archive.toString('base64'),
    entries,
  };
}

function jsString(value) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script');
}

async function main() {
  const payload = await buildPayload(targetPath);
  await mkdir(backupDir, { recursive: true });

  const ws = await connectEasyEdaPage();
  try {
    const dbName = await evaluate(ws, `
      (await indexedDB.databases())
        .map((db) => db.name)
        .filter(Boolean)
        .find((name) => /^User_.*_v\\d+$/.test(name))
    `);
    if (!dbName) throw new Error('Could not find the EasyEDA user IndexedDB database.');

    const backup = await evaluate(ws, `
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(${jsString(dbName)});
        request.onerror = () => reject(new Error(request.error?.message || 'open failed'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['extensionsIndex', 'extensionsObjectStorage', 'extensionsUserConfig'], 'readonly');
          const out = { dbName: ${jsString(dbName)}, uuid: ${jsString(uuid)}, index: null, userConfig: null, objects: [] };
          tx.objectStore('extensionsIndex').get(${jsString(uuid)}).onsuccess = (event) => { out.index = event.target.result || null; };
          tx.objectStore('extensionsUserConfig').get(${jsString(uuid)}).onsuccess = (event) => { out.userConfig = event.target.result || null; };
          const cursorRequest = tx.objectStore('extensionsObjectStorage').openCursor();
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const value = cursor.value;
            if (value?.uuid === ${jsString(uuid)} || String(value?.key || '').startsWith(${jsString(`${uuid}|`)})) {
              out.objects.push({ key: value.key, uuid: value.uuid, path: value.path, sourceSize: value.source?.size ?? null, sourceType: value.source?.type ?? null });
            }
            cursor.continue();
          };
          tx.oncomplete = () => { db.close(); resolve(out); };
          tx.onerror = () => { db.close(); reject(new Error(tx.error?.message || 'transaction failed')); };
        };
      })
    `);

    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const backupPath = join(backupDir, `extension-${uuid}-${timestamp}.json`);
    await writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');

    if (dryRun) {
      console.log(JSON.stringify({
        dryRun: true,
        dbName,
        uuid,
        backupPath,
        currentDisplayName: backup.index?.config?.displayName || backup.index?.config?.name || null,
        currentVersion: backup.index?.config?.version || null,
        nextDisplayName: payload.config.displayName || payload.config.name,
        nextVersion: payload.config.version,
        fileCount: payload.entries.length,
        fileSize: payload.fileSize,
      }, null, 2));
      return;
    }

    const installResult = await evaluate(ws, `
      await new Promise((resolve, reject) => {
        const payload = ${jsString(payload)};
        const extensionUuid = ${jsString(uuid)};
        const b64ToBytes = (base64) => {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          return bytes;
        };
        const request = indexedDB.open(${jsString(dbName)});
        request.onerror = () => reject(new Error(request.error?.message || 'open failed'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['extensionsIndex', 'extensionsObjectStorage', 'extensionsUserConfig'], 'readwrite');
          const indexStore = tx.objectStore('extensionsIndex');
          const objectStore = tx.objectStore('extensionsObjectStorage');
          const userConfigStore = tx.objectStore('extensionsUserConfig');
          let previousIndex = null;
          let previousUserConfig = null;
          indexStore.get(extensionUuid).onsuccess = (event) => { previousIndex = event.target.result || null; };
          userConfigStore.get(extensionUuid).onsuccess = (event) => { previousUserConfig = event.target.result || null; };
          const cursorRequest = objectStore.openCursor();
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const value = cursor.value;
            if (value?.uuid === extensionUuid || String(value?.key || '').startsWith(extensionUuid + '|')) cursor.delete();
            cursor.continue();
          };
          tx.oncomplete = () => {
            const writeTx = db.transaction(['extensionsIndex', 'extensionsObjectStorage', 'extensionsUserConfig'], 'readwrite');
            const writeIndexStore = writeTx.objectStore('extensionsIndex');
            const writeObjectStore = writeTx.objectStore('extensionsObjectStorage');
            const writeUserConfigStore = writeTx.objectStore('extensionsUserConfig');
            const fileIndex = payload.entries.map((entry) => entry.path);
            const now = Date.now();
            const nextIndex = {
              ...(previousIndex || {}),
              uuid: extensionUuid,
              config: payload.config,
              fileIndex,
              fileSize: payload.fileSize,
              installationTime: previousIndex?.installationTime || now,
              updateTime: now,
              isEnable: previousIndex?.isEnable ?? true,
              isAllowExternalInteractions: previousIndex?.isAllowExternalInteractions ?? true,
              isAutoUpdate: previousIndex?.isAutoUpdate ?? true,
              isOnlineSync: previousIndex?.isOnlineSync ?? false,
              isShowAtHeaderMenu: previousIndex?.isShowAtHeaderMenu ?? true,
              isInExtensionStore: previousIndex?.isInExtensionStore ?? false,
            };
            writeIndexStore.put(nextIndex);
            writeUserConfigStore.put(previousUserConfig || { uuid: extensionUuid, configs: {} });
            writeObjectStore.put({
              key: extensionUuid,
              uuid: extensionUuid,
              path: '',
              source: new File([b64ToBytes(payload.archiveBase64)], payload.eextFileName, { type: 'application/octet-stream' }),
            });
            for (const entry of payload.entries) {
              const source = new File([b64ToBytes(entry.base64)], entry.name, { type: entry.type });
              writeObjectStore.put({
                key: extensionUuid + '|' + entry.path,
                uuid: extensionUuid,
                path: entry.path,
                source,
              });
            }
            writeTx.oncomplete = () => {
              db.close();
              resolve({
                dbName: ${jsString(dbName)},
                uuid: extensionUuid,
                displayName: payload.config.displayName || payload.config.name,
                version: payload.config.version,
                fileCount: payload.entries.length,
                fileSize: payload.fileSize,
                backupPath: ${jsString(backupPath)},
                externalInteractions: nextIndex.isAllowExternalInteractions,
                autoUpdate: nextIndex.isAutoUpdate,
              });
            };
            writeTx.onerror = () => { db.close(); reject(new Error(writeTx.error?.message || 'write transaction failed')); };
          };
          tx.onerror = () => { db.close(); reject(new Error(tx.error?.message || 'delete transaction failed')); };
        };
      })
    `, 120_000);

    console.log(JSON.stringify(installResult, null, 2));
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
