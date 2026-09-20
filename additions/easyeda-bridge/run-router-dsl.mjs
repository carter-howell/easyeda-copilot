#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPcbRouterDsl } from '../../mcp/dist/routing/routing-operation.js';
import { operationManager } from '../../mcp/dist/operations/manager.js';
import { positiveTimeout, withProxy } from './request-easyeda.mjs';

function removeOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name} value.`);
  args.splice(index, 2);
  return value;
}

export function parseRouterArgs(argv, env = process.env) {
  const args = [...argv];
  const instanceId = removeOption(args, '--instance') || env.EASYEDA_COPILOT_INSTANCE_ID;
  const timeoutMs = positiveTimeout(removeOption(args, '--timeout-ms') || env.EASYEDA_ROUTER_TIMEOUT_MS || 720_000);
  const [fileArg, ...unexpected] = args;
  if (unexpected.length) throw new Error(`Unexpected arguments: ${unexpected.join(' ')}`);
  return { fileArg, instanceId, timeoutMs };
}

async function run() {
  const { fileArg, instanceId, timeoutMs } = parseRouterArgs(process.argv.slice(2));
  if (!fileArg || fileArg === '--help') {
    console.log('Usage: node run-router-dsl.mjs <routing.dsl.js> [--instance ID] [--timeout-ms MS]');
    return;
  }

  const result = await withProxy(async proxy => {
    const bridge = {
      requestEasyEda: (event, body = {}) => proxy.request(event, body, instanceId),
    };
    const deadline = Date.now() + timeoutMs;
    let operationId;
    let cancelling = false;
    const cancel = async reason => {
      if (!operationId || cancelling) return;
      cancelling = true;
      await operationManager.cancel(operationId).catch(() => undefined);
      if (reason) console.error(reason);
    };
    const onSignal = () => { void cancel('Router cancellation requested.'); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      let status = await runPcbRouterDsl(bridge, resolve(fileArg), Math.min(55_000, timeoutMs));
      operationId = status?.operation_id;
      while (status?.status === 'running') {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          await cancel(`Router exceeded its ${timeoutMs} ms wall-clock limit.`);
          throw new Error(`Router timed out and cancellation was requested (operation_id: ${operationId}).`);
        }
        status = await operationManager.wait(operationId, Math.min(55_000, remaining));
      }
      return status;
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }, { instanceId, timeoutMs: timeoutMs + 310_000 });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error(JSON.stringify({ ok: false, error: String(error) }));
    process.exitCode = 1;
  });
}
