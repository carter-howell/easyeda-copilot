#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { WebSocket } = require('ws');

const port = Number(process.env.EASYEDA_REMOTE_DEBUGGING_PORT || 9222);
const timeout = Number(process.env.EASYEDA_DEVTOOLS_TIMEOUT_MS || 20_000);
let expression = process.argv.slice(2).join(' ');

if (process.argv[2] === '--file') {
  const expressionPath = process.argv[3];
  if (!expressionPath) {
    console.error('Usage: node run-easyeda-pro-devtools-expression.mjs --file <expression.js>');
    process.exit(2);
  }
  expression = readFileSync(expressionPath, 'utf8');
}

if (!expression) {
  console.error('Usage: node run-easyeda-pro-devtools-expression.mjs "<javascript expression>"');
  console.error('   or: node run-easyeda-pro-devtools-expression.mjs --file <expression.js>');
  process.exit(2);
}

async function getJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } catch (error) {
    const code = error?.cause?.code || error?.code || '';
    const address = error?.cause?.address || '127.0.0.1';
    const portText = error?.cause?.port || port;
    if (code === 'ECONNREFUSED') {
      throw new Error(`EasyEDA debug port is not ready at ${address}:${portText}`);
    }
    throw error;
  }
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

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const preferredTargetText = process.env.EASYEDA_TARGET_CONTAINS || process.env.EASYEDA_PROJECT_ID || '';
  const editorPages = targets.filter((target) => {
    if (target.type !== 'page') return false;
    const url = String(target.url ?? '');
    return /pro\.easyeda\.com\/editor/.test(url) || /^https:\/\/client\/editor\b/.test(url);
  });
  const page = (preferredTargetText
    ? editorPages.find((target) => `${target.title ?? ''} ${target.url ?? ''}`.includes(preferredTargetText))
    : null)
    ?? editorPages.find((target) => /#id=/.test(target.url ?? ''))
    ?? editorPages[0];

  if (!page?.webSocketDebuggerUrl) {
    const pageSummaries = targets
      .filter((target) => target.type === 'page')
      .map((target) => `${target.title ?? '(untitled)'} ${target.url ?? ''}`.trim())
      .slice(0, 5);
    throw new Error(`No EasyEDA editor page target found on debug port ${port}. Refusing to evaluate against non-EasyEDA page targets. Open EasyEDA Pro with remote debugging and an editor project page. Visible page targets: ${pageSummaries.join(' | ') || 'none'}`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  try {
    const result = await call(ws, 'Runtime.evaluate', {
      expression: `Promise.resolve((async () => { return (${expression}); })())`,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      const message = details.exception?.description || details.text || JSON.stringify(details);
      console.error(message);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result.result.value, null, 2));
    }
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
