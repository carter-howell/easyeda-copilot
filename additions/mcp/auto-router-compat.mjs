import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_WAIT_MS = 30_000;

function normalizedNets(values, name) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
  const result = values.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${name}[${index}] must be a non-empty string.`);
    }
    return value.trim();
  });
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${name} contains duplicate net names.`);
  }
  return result;
}

export function buildCompatibilityAutoRouteDsl({ nets, ignoreNets } = {}) {
  const selected = normalizedNets(nets, 'nets');
  const ignored = normalizedNets(ignoreNets, 'ignoreNets');
  const ignoredSet = new Set(ignored);
  const overlap = selected.filter(net => ignoredSet.has(net));
  if (overlap.length) {
    throw new TypeError(`The same net cannot be selected and ignored: ${overlap.join(', ')}.`);
  }

  const lines = [
    '// EasyEDA 3.2.149 compatibility autorouter.',
    '// Existing copper is preserved; no routing-clear operation is emitted.',
  ];
  if (selected.length) lines.push(`onlyNets(${selected.map(JSON.stringify).join(', ')});`);
  if (ignored.length) lines.push(`ignoreNets(${ignored.map(JSON.stringify).join(', ')});`);
  lines.push('runAll();', '');
  return lines.join('\n');
}

async function writeCompatibilityDsl(options) {
  const directory = join(tmpdir(), 'easyeda-copilot', 'compatibility-autorouter');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${randomUUID()}.routing.js`);
  await writeFile(file, buildCompatibilityAutoRouteDsl(options), 'utf8');
  return file;
}

export function registerCompatibilityAutoRouter({
  server,
  bridge,
  runPcbRouterDsl,
  textResult,
  z,
}) {
  server.registerTool(
    'auto_route_pcb',
    {
      title: 'Auto Route PCB',
      description: 'Route currently unrouted PCB nets with the EasyEDA Copilot transactional router. This compatibility command is used when the installed EasyEDA desktop build does not expose pcb_Document.autoRouting(). Existing copper is preserved, current native DRC rules are imported, the preferred backend is attempted first, and KRT is used as the supported fallback. Long work returns an operation_id for wait_operation.',
      inputSchema: z.object({
        nets: z.array(z.string().min(1)).optional()
          .describe('Optional exact net names to route. Omit to route all currently unrouted nets.'),
        ignore_nets: z.array(z.string().min(1)).optional()
          .describe('Optional exact net names to leave unrouted.'),
        wait_ms: z.number().int().min(1_000).max(55_000).default(DEFAULT_WAIT_MS)
          .describe('Initial synchronous wait before returning an operation_id.'),
      }),
    },
    async ({ nets, ignore_nets, wait_ms }) => {
      const file = await writeCompatibilityDsl({ nets, ignoreNets: ignore_nets });
      const result = await runPcbRouterDsl(bridge, file, wait_ms ?? DEFAULT_WAIT_MS);
      return textResult({
        compatibility_autorouter: true,
        native_autoRouting_available: false,
        preserves_existing_copper: true,
        result,
      });
    },
  );
}
