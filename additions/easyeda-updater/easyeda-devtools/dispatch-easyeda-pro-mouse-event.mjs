#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { WebSocket } = require('ws');

const port = Number(process.env.EASYEDA_REMOTE_DEBUGGING_PORT || 9222);
const [kind = 'click', xText, yText] = process.argv.slice(2);
const x = Number(xText);
const y = Number(yText);

if (!Number.isFinite(x) || !Number.isFinite(y)) {
  console.error('Usage: node dispatch-easyeda-pro-mouse-event.mjs <click|dblclick> <x> <y>');
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
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== id) return;
      ws.off('message', onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    ws.on('message', onMessage);
  });
}
call.nextId = 1;

const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
const page = targets.find((target) => target.type === 'page' && /pro\.easyeda\.com\/editor/.test(target.url))
  ?? targets.find((target) => target.type === 'page');
if (!page?.webSocketDebuggerUrl) throw new Error('No EasyEDA page target found.');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

try {
  await call(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  const clicks = kind === 'dblclick' ? 2 : 1;
  for (let i = 1; i <= clicks; i += 1) {
    await call(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: i });
    await call(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: i });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  console.log(JSON.stringify({ kind, x, y, dispatched: true }, null, 2));
} finally {
  ws.close();
}
