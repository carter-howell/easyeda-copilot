import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { withProxy } from '../easyeda-bridge/request-easyeda.mjs';
import { saveEditorDocuments } from '../easyeda-updater/save-documents.mjs';
import { parseRouterArgs } from '../easyeda-bridge/run-router-dsl.mjs';
import { buildCompatibilityAutoRouteDsl } from '../mcp/auto-router-compat.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function moduleFrom(file, globals = {}) {
  const code = await readFile(new URL(file, import.meta.url), 'utf8');
  const context = { exports: {}, ...globals };
  vm.runInNewContext(ts.transpile(code, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context);
  return context.exports;
}

test('router runner parses bounded execution controls without starting a job', () => {
  assert.deepEqual(
    parseRouterArgs(['board-route.js', '--instance', 'editor-2', '--timeout-ms', '90000'], {}),
    { fileArg: 'board-route.js', instanceId: 'editor-2', timeoutMs: 90000 },
  );
  assert.deepEqual(
    parseRouterArgs(['board-route.js'], {
      EASYEDA_COPILOT_INSTANCE_ID: 'editor-env',
      EASYEDA_ROUTER_TIMEOUT_MS: '45000',
    }),
    { fileArg: 'board-route.js', instanceId: 'editor-env', timeoutMs: 45000 },
  );
  assert.throws(() => parseRouterArgs(['board-route.js', '--timeout-ms'], {}), /Missing --timeout-ms value/);
  assert.throws(() => parseRouterArgs(['board-route.js', '--timeout-ms', '0'], {}), /Invalid timeout/);
  assert.throws(() => parseRouterArgs(['board-route.js', 'extra'], {}), /Unexpected arguments/);
});

test('compatibility autorouter preserves copper and scopes nets safely', () => {
  assert.equal(
    buildCompatibilityAutoRouteDsl(),
    [
      '// EasyEDA 3.2.149 compatibility autorouter.',
      '// Existing copper is preserved; no routing-clear operation is emitted.',
      'runAll();',
      '',
    ].join('\n'),
  );
  const scoped = buildCompatibilityAutoRouteDsl({
    nets: ['SDA', 'SCL'],
    ignoreNets: ['GND'],
  });
  assert.match(scoped, /onlyNets\("SDA", "SCL"\);/);
  assert.match(scoped, /ignoreNets\("GND"\);/);
  assert.doesNotMatch(scoped, /clearRouting\(/);
  assert.throws(
    () => buildCompatibilityAutoRouteDsl({ nets: ['SDA'], ignoreNets: ['SDA'] }),
    /cannot be selected and ignored/,
  );
  assert.throws(
    () => buildCompatibilityAutoRouteDsl({ nets: ['SDA', 'SDA'] }),
    /duplicate net names/,
  );
});

test('execute_js cancellation is cooperative and does not leak between runs', async () => {
  const { beginJavaScriptExecution, interruptJavaScriptExecution } = await moduleFrom('../extension/execute-js-control.ts');
  const idle = interruptJavaScriptExecution();
  assert.equal(idle.interrupted, false);
  assert.equal(idle.status, 'idle');
  const first = beginJavaScriptExecution();
  assert.equal(first.control.cancelled, false);
  const interrupted = interruptJavaScriptExecution('test cancellation');
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.status, 'cancel_requested');
  assert.equal(interrupted.executionId, first.control.executionId);
  assert.equal(first.control.cancelled, true);
  assert.throws(() => first.control.throwIfCancelled(), /test cancellation/);
  first.finish();
  assert.equal(interruptJavaScriptExecution().status, 'idle');
  const second = beginJavaScriptExecution();
  assert.equal(second.control.cancelled, false);
  assert.notEqual(second.control.executionId, first.control.executionId);
  second.finish();
});

test('PCB export prefers an explicit catalog UUID and safely falls back', async () => {
  const { getCatalogDeviceId } = await moduleFrom('../extension/catalog-device-id.ts');
  assert.equal(
    getCatalogDeviceId({ 'Copilot Catalog UUID': '264b5463318547fc8da54acb9211734a' }, '02e111fcab4ade28'),
    '264b5463318547fc8da54acb9211734a',
  );
  assert.equal(getCatalogDeviceId({ 'Copilot Catalog UUID': 'not-an-id' }, '02e111fcab4ade28'), '02e111fcab4ade28');
  assert.equal(getCatalogDeviceId(undefined, undefined), null);
});

test('MCP import confirmation uses the exact Apply Changes renderer action', async () => {
  const { APPLY_CHANGES_EXPRESSION, confirmEasyEdaImportChanges } = await import('../mcp/confirm-easyeda-import.mjs');
  let evaluated;
  const result = await confirmEasyEdaImportChanges({
    port: 19001,
    getTargets: async port => port === 19001 ? [{ webSocketDebuggerUrl: 'ws://editor' }] : [],
    evaluate: async (target, expression) => {
      evaluated = { target, expression };
      return { status: 'applied', method: 'react-handler' };
    },
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.method, 'react-handler');
  assert.equal(evaluated.target.webSocketDebuggerUrl, 'ws://editor');
  assert.equal(evaluated.expression, APPLY_CHANGES_EXPRESSION);
  assert.match(APPLY_CHANGES_EXPRESSION, /text !== 'Apply Changes'/);
  assert.match(APPLY_CHANGES_EXPRESSION, /__reactProps\$/);
});

test('every library scope has its own verified lookup; results are not duplicated', async () => {
  const calls = [];
  const search = async (q, lib) => { calls.push(lib); return [{ uuid: 'device', libraryUuid: lib }]; };
  const eda = {
    lib_LibrariesList: {
      ...Object.fromEntries(['System', 'Personal', 'Project', 'Favorite'].map(name => ['get' + name + 'LibraryUuid', async () => name])),
      getAllLibrariesList: async () => [
        { name: 'Public', uuid: 'PublicUuid' },
        { name: 'Std Edition Public', uuid: 'StdPublicUuid' },
        { name: 'LCSC Electronics Parts', uuid: 'LcscUuid' },
      ],
    },
    lib_Device: { search }, lib_Footprint: { search }, lib_PanelLibrary: { search },
  };
  const { searchComponentLibraries } = await moduleFrom('../extension/library-search.ts', { eda });
  const result = await searchComponentLibraries({ query: 'PCA9685', libraries: ['all'], kind: 'all' });
  assert.equal(result.sections.length, 24);
  assert.deepEqual([...new Set(calls)], ['System', 'recent', 'Personal', 'Project', 'PublicUuid', 'StdPublicUuid', 'Favorite', 'LcscUuid']);
  assert.equal(result.flatResults, undefined);
  assert.equal(result.sections.every(s => s.count === 1 && !s.error), true);
  eda.lib_LibrariesList.getPersonalLibraryUuid = async () => { throw Error('offline'); };
  const partial = await searchComponentLibraries({ query: 'PCA9685' });
  assert.equal(partial.sections.filter(s => s.error).length, 1);
  assert.equal(partial.sections.filter(s => s.count === 1).length, 7);
  await assert.rejects(() => searchComponentLibraries({ query: 'x', page: 1.2 }), /pagination/);
});

test('failed schematic cleanup still attempts PCB and preserves board for retry', async () => {
  const { deleteBoardWithDocuments } = await moduleFrom('../extension/delete-board.ts');
  const board = { name: 'test', schematic: { uuid: 'sch' }, pcb: { uuid: 'pcb' } };
  const calls = [];
  let boardExists = true;
  const api = {
    boards: async () => boardExists ? [board] : [],
    deleteBoard: async () => { calls.push('board'); boardExists = false; return true; },
    deleteSchematic: async () => { calls.push('sch'); throw Error('temporary'); },
    deletePcb: async () => { calls.push('pcb'); delete board.pcb; return true; },
  };
  const first = await deleteBoardWithDocuments('test', api);
  assert.equal(first.success, false);
  assert.deepEqual(calls, ['sch', 'pcb']);
  api.deleteSchematic = async () => { calls.push('sch'); delete board.schematic; return true; };
  assert.equal((await deleteBoardWithDocuments('test', api)).success, true);
  assert.deepEqual(calls, ['sch', 'pcb', 'sch', 'board']);
});

test('deletion accepts automatic removal of the empty board', async () => {
  const { deleteBoardWithDocuments } = await moduleFrom('../extension/delete-board.ts');
  let exists = true;
  const result = await deleteBoardWithDocuments('test', {
    boards: async () => exists ? [{ name: 'test', schematic: { uuid: 's' }, pcb: { uuid: 'p' } }] : [],
    deleteSchematic: async () => true,
    deletePcb: async () => { exists = false; return true; },
    deleteBoard: async () => { throw Error('Should not delete an absent board'); },
  });
  assert.equal(result.success, true);
});

test('save visits split panes and fails closed on a failed save', async () => {
  const calls = [];
  const tabs = [{ tabId: 's', data: { doctype: 1 } }, { tabId: 'p', data: { doctype: 3 } }, { tabId: 'n', data: { doctype: 26 } }];
  const rpc = async (method, arg) => {
    calls.push([method, arg]);
    if (method.endsWith('getSplitScreenTree')) return { children: tabs.map(tab => ({ tabs: [tab] })) };
    if (method.endsWith('activateDocument')) return true;
    return { success: true };
  };
  assert.deepEqual(await saveEditorDocuments(rpc), ['s', 'p', 'n']);
  assert.equal(calls.filter(([m]) => m.endsWith('_Document.save')).length, 3);
  await assert.rejects(() => saveEditorDocuments(async (m, a) => m.endsWith('_Document.save') ? false : rpc(m, a)), /Save failed/);
});

test('bridge forwards instance selection and promptly rejects disconnection', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  server.on('connection', socket => {
    socket.on('message', data => {
      const m = JSON.parse(String(data));
      const b = JSON.parse(m.body);
      if (m.event === 'proxy:hello') socket.send(JSON.stringify({ event: 'proxy:hello:result', body: JSON.stringify({ ok: true }) }));
      else if (b.event === 'disconnect') socket.close();
      else socket.send(JSON.stringify({ event: 'proxy:response', body: JSON.stringify({ id: b.id, ok: true, result: b.targetInstanceId }) }));
    });
  });
  const options = { url: 'ws://127.0.0.1:' + server.address().port, instanceId: 'second-editor', timeoutMs: 3000 };
  try {
    assert.equal(await withProxy(p => p.request('read'), options), 'second-editor');
    await assert.rejects(() => withProxy(p => p.request('disconnect'), options), /disconnected/);
  } finally { for (const s of server.clients) s.terminate(); await new Promise(resolve => server.close(resolve)); }
});

test('schema accepts project and Standard Edition device IDs with library identity', async () => {
  const lcsc = await moduleFrom('../../shared/types/lcsc.ts', { require });
  const { CircuitModStruct } = await moduleFrom('../../shared/types/circuit.ts', {
    require: id => id === './reused' ? {} : id === './lcsc' ? lcsc : require(id),
  });
  for (const part_uuid of [
    { uuid: '0fc94267955b4842', libraryUuid: 'user' },
    { uuid: 'deviceFromSTD[4df30f666ff9467c8e3913b168dffa0d]', libraryUuid: 'stdPublic' },
  ]) {
    const input = { add_components: [{ part_uuid, library_uuid: 'stdPublic', designator: 'U1', value: 'PCA9685', pins: [], block_name: 'servo', search_query: 'PCA9685' }], add_reused_blocks: [], rm_components: null, external_connect: null, external_rm_connect: null };
    assert.equal(CircuitModStruct().parse(input).add_components[0].part_uuid.libraryUuid, part_uuid.libraryUuid);
  }
});

test('library placement preserves the exact reference, catalog identity, and rolls back a failed create', async () => {
  let reference;
  let properties = {};
  let restored = false;
  const primitive = {
    setState_Designator() { return this; }, setState_Name() { return this; },
    getState_OtherProperty() { return properties; },
    setState_OtherProperty(value) { properties = value; return this; },
    async done() { return this; }, getState_PrimitiveId() { return 'placed'; },
  };
  const eda = {
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ documentType: 1 }) },
    dmt_Project: { getCurrentProjectInfo: async () => ({ uuid: 'project-uuid' }) },
    lib_Device: { get: async (uuid, libraryUuid) => ({ uuid, libraryUuid }) },
    sch_PrimitiveComponent: { getAll: async () => [], create: async ref => { reference = ref; return primitive; } },
    sch_Document: { save: async () => true },
  };
  const dependencies = {
    checkpointer: { save: async () => 'checkpoint', restore: async () => { restored = true; return true; } },
    readWholeSchematic: async () => ({ components: [] }),
    validateRemovalTargets: () => {},
    getPrimitiveComponentPins: async () => [],
    getBBox: async () => ({ maxX: 100, width: 100 }),
    placeNet: async () => {}, rmNet: async () => {}, removeComponent: async () => {},
  };
  const { applyLibraryCircuit } = await moduleFrom('../extension/library-circuit.ts', { eda, EDMT_EditorDocumentType: { SCHEMATIC_PAGE: 1 }, ESCH_PrimitiveComponentType: { DRAWING: 'sheet' }, require: () => dependencies });
  const input = { add_components: [{ designator: 'U1', part_uuid: '4df30f666ff9467c8e3913b168dffa0d', library_uuid: 'user', value: 'PCA9685', pins: [] }], add_reused_blocks: [], rm_components: null };
  assert.equal((await applyLibraryCircuit(input)).saved, true);
  assert.equal(reference.libraryUuid, 'user');
  assert.equal(reference.uuid, input.add_components[0].part_uuid);
  assert.equal(properties['Copilot Catalog UUID'], input.add_components[0].part_uuid);
  eda.sch_PrimitiveComponent.create = async () => { throw Error('missing symbol'); };
  await assert.rejects(() => applyLibraryCircuit(input), /restored=true/);
  assert.equal(restored, true);
  await assert.rejects(() => applyLibraryCircuit({ ...input, add_components: [input.add_components[0], input.add_components[0]], rm_components: ['U1'] }), /Duplicate designator/);
});

test('whole-page snapshot ignores selection and validates all removals before mutation', async () => {
  let ids;
  let items = [
    { getState_Designator: () => 'J12', getState_PrimitiveId: () => 'j12' },
    { getState_Designator: () => 'U2', getState_PrimitiveId: () => 'u2' },
    { getState_Designator: () => undefined, getState_PrimitiveId: () => 'sheet' },
  ];
  const api = await moduleFrom('../extension/schematic-snapshot.ts', {
    eda: { sch_PrimitiveComponent: { getAll: async () => items } },
    require: () => ({ getSchematic: async (requested, options) => {
      ids = requested;
      assert.equal(options.disableExtractPartUuid, true);
      return { components: [{ designator: 'J12' }, { designator: 'U2' }] };
    } }),
  });
  const snapshot = await api.readWholeSchematic();
  assert.deepEqual([...ids], ['j12', 'u2']);
  api.validateRemovalTargets(snapshot, ['J12']);
  assert.throws(() => api.validateRemovalTargets(snapshot, ['J99']), /missing/);
  assert.throws(() => api.validateRemovalTargets(snapshot, ['J12', 'J12']), /Duplicate/);
  items = [];
  ids = undefined;
  assert.equal((await api.readWholeSchematic()).components.length, 0);
  assert.equal(ids, undefined);
});

test('pin scan skips drawing sheets and surfaces failed pin reads', async () => {
  const calls = [];
  const eda = { sch_PrimitiveComponent: {
    getAll: async () => ['part', 'sheet', 'netflag'].map(type => ({
      getState_ComponentType: () => type, getState_PrimitiveId: () => type,
    })),
    getAllPinsByPrimitiveId: async id => { calls.push(id); return []; },
  } };
  const { readSchematicPins } = await moduleFrom('../extension/schematic-snapshot.ts', {
    eda, ESCH_PrimitiveComponentType: { DRAWING: 'sheet' }, require: () => ({}),
  });
  assert.equal((await readSchematicPins()).length, 2);
  assert.deepEqual(calls, ['part', 'netflag']);
  eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId = async () => undefined;
  await assert.rejects(() => readSchematicPins(), /Cannot read schematic pins/);
});

test('Project devices use exact paginated search metadata without the broken detail lookup', async () => {
  const item = { uuid: '0fc94267955b4842', libraryUuid: 'project-uuid', symbolUuid: 'symbol', footprintUuid: 'footprint' };
  const pages = [];
  const eda = {
    dmt_Project: { getCurrentProjectInfo: async () => ({ uuid: 'project-uuid' }) },
    lib_Device: {
      get: async () => { throw Error('parent_tag'); },
      search: async (q, library, a, b, limit, page) => {
        assert.equal(library, 'project');
        assert.equal(q, 'PCA9685');
        pages.push(page);
        return page === 1 ? Array.from({ length: limit }, () => ({ uuid: 'other' })) : [item];
      },
    },
    lib_Symbol: { get: async (uuid, library) => {
      assert.equal(uuid, 'symbol'); assert.equal(library, 'project');
      return { subPartNames: ['MODULE.1'] };
    } },
  };
  const { resolveCircuitDevice } = await moduleFrom('../extension/library-circuit.ts', { eda, require: () => ({}) });
  const input = { part_uuid: item.uuid, library_uuid: 'project-uuid', search_query: 'PCA9685', designator: 'U1' };
  const resolved = await resolveCircuitDevice(input);
  assert.equal(resolved.reference, item);
  assert.equal(resolved.subPartName, 'MODULE.1');
  assert.deepEqual(pages, [1, 2]);
  await assert.rejects(() => resolveCircuitDevice({ ...input, part_uuid: 'missing' }), /Exact Project device not found/);
});
