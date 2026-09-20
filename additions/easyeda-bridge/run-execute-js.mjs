#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { withProxy } from './request-easyeda.mjs';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
let outputPath;
if (outputIndex >= 0) {
  outputPath = args[outputIndex + 1];
  if (!outputPath) throw new Error('Missing --output value.');
  args.splice(outputIndex, 2);
}
const instanceIndex = args.indexOf('--instance');
let instanceId = process.env.EASYEDA_COPILOT_INSTANCE_ID;
if (instanceIndex >= 0) {
  instanceId = args[instanceIndex + 1];
  if (!instanceId) throw new Error('Missing --instance value.');
  args.splice(instanceIndex, 2);
}

const [scriptArg, inputsArg, timeoutArg] = args;
if (!scriptArg || scriptArg === '--help') {
  console.log('Usage: node run-execute-js.mjs <script.js> [inputs.json] [timeout-ms] [--instance ID]');
  process.exit(0);
}

const scriptPath = resolve(scriptArg);
const inputMap = inputsArg ? JSON.parse(await readFile(resolve(inputsArg), 'utf8')) : {};
const inputs = {};
for (const [name, path] of Object.entries(inputMap)) {
  inputs[name] = await readFile(resolve(String(path)), 'utf8');
}

const timeoutMs = Number(timeoutArg || process.env.EASYEDA_COPILOT_BRIDGE_TIMEOUT_MS || 120000);
const code = await readFile(scriptPath, 'utf8');
const result = await withProxy(
  proxy => proxy.request('execute-js', { code, inputs }),
  { instanceId, timeoutMs },
);
if (result?.result?.kind === 'binary' && outputPath) {
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, Buffer.from(result.result.base64, 'base64'));
  result.result = {
    kind: 'saved-binary',
    mime_type: result.result.mime_type,
    path: resolvedOutput,
  };
}
console.log(JSON.stringify({ ok: true, result }, null, 2));
