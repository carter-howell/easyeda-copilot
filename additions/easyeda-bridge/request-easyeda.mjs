#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function positiveTimeout(value = 120000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new Error('Invalid timeout: ' + value);
  return n;
}

export async function withProxy(action, options = {}) {
  const socket = new WebSocket(options.url || process.env.EASYEDA_COPILOT_BRIDGE_URL || 'ws://127.0.0.1:8787');
  const timeoutMs = positiveTimeout(options.timeoutMs ?? process.env.EASYEDA_COPILOT_BRIDGE_TIMEOUT_MS ?? 120000);
  const send = (event, body) => socket.send(JSON.stringify({ event, body: JSON.stringify(body) }));
  const wait = (accept, start, duration) => new Promise((resolve, reject) => {
    const finish = (error, result) => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('open', start);
      error ? reject(error) : resolve(result);
    };
    const onClose = () => finish(new Error('Bridge disconnected; execution status is unconfirmed. Inspect state before retrying mutations.'));
    const onError = () => finish(new Error('Bridge socket error.'));
    const onMessage = event => {
      try {
        const message = JSON.parse(String(event.data));
        const body = message.body ? JSON.parse(message.body) : {};
        if (!accept(message, body)) return;
        finish(body.ok === false ? new Error(body.error || 'Bridge request failed') : null, body.result);
      } catch (error) { finish(error); }
    };
    const timer = setTimeout(() => finish(new Error('Bridge timeout; execution status is unconfirmed. Inspect state before retrying mutations.')), duration);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    if (socket.readyState === WebSocket.OPEN) start();
    else socket.addEventListener('open', start, { once: true });
  });
  try {
    await wait(m => m.event === 'proxy:hello:result', () => send('proxy:hello', { protocolVersion: 1 }), Math.min(timeoutMs, 10000));
    const request = (event, body = {}) => {
      const id = randomUUID();
      return wait((m, b) => m.event === 'proxy:response' && b.id === id, () => send(event, { ...body, id }), timeoutMs + 1000);
    };
    return await action({
      list: () => request('proxy:list-easyeda-instances'),
      request: (event, body = {}, targetInstanceId = options.instanceId) => request('proxy:request-easyeda', { event, body, timeoutMs, targetInstanceId }),
    });
  } finally { socket.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const instanceIndex = args.indexOf('--instance');
  let instanceId = process.env.EASYEDA_COPILOT_INSTANCE_ID;
  if (instanceIndex >= 0) {
    instanceId = args[instanceIndex + 1];
    if (!instanceId) throw new Error('Missing --instance value');
    args.splice(instanceIndex, 2);
  }
  const [command, bodyArg, timeoutArg] = args;
  if (!command || command === '--help') {
    console.log('Usage: node request-easyeda.mjs <event> [body-json-or-file] [timeout-ms] [--instance ID]\n       node request-easyeda.mjs --list [timeout-ms]');
    return;
  }
  let body = {};
  if (command !== '--list' && bodyArg) {
    const value = bodyArg.trim();
    body = JSON.parse(value.startsWith('{') ? value : (await readFile(bodyArg, 'utf8')).replace(/^\uFEFF/, ''));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Body must be a JSON object');
  }
  const result = await withProxy(proxy => command === '--list' ? proxy.list() : proxy.request(command, body), {
    instanceId, timeoutMs: positiveTimeout((command === '--list' ? bodyArg : timeoutArg) ?? process.env.EASYEDA_COPILOT_BRIDGE_TIMEOUT_MS ?? 120000),
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, error: String(error) })); process.exitCode = 1; });
}
