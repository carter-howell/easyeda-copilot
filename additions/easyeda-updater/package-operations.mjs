import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { editorTargets, evaluate } from './cdp.mjs';
import { saveEditorDocuments } from './save-documents.mjs';
import { withProxy } from '../easyeda-bridge/request-easyeda.mjs';
import { confirmEasyEdaImportChanges } from '../mcp/confirm-easyeda-import.mjs';

const [command, packageFile, projectId, portArg] = process.argv.slice(2);
const port = Number(portArg || 9222);
const hash = data => createHash('sha256').update(data).digest('hex');

async function main() {
  const bytes = await readFile(packageFile);
  const zip = await JSZip.loadAsync(bytes);
  const config = JSON.parse(await zip.file('extension.json')?.async('string') || 'null');
  const entry = zip.file('dist/index.js');
  if (!config?.uuid || !config.version || !entry) throw new Error('Invalid extension package');
  const expectedHash = hash(await entry.async('nodebuffer'));
  if (command === 'metadata') return { uuid: config.uuid, version: config.version, entryHash: expectedHash };
  if (command === 'bridge') {
    return withProxy(async proxy => {
      const instances = await proxy.list();
      const errors = [];
      for (const instance of instances) {
        try {
          const info = await proxy.request('get-current-project-info', {}, instance.instanceId);
          if (info.project_uuid === projectId || info.project_id === projectId) return { instanceId: instance.instanceId, projectId };
        } catch (error) { errors.push(String(error)); }
      }
      throw new Error('No responding bridge instance for project ' + projectId + ': ' + errors.join('; '));
    }, { timeoutMs: 15000 });
  }
  const targets = await editorTargets(port);
  if (!targets.length) throw new Error('No EasyEDA editor target; refusing to modify or close the editor.');
  if (command === 'save' || command === 'reload') {
    const saved = [];
    for (const target of targets) saved.push(await evaluate(target, `(${saveEditorDocuments.toString()})((...args)=>window.top._MSG_BUS2_EXTAPI_.rpcCall(...args))`, 60000));
    if (command === 'reload') {
      for (const target of targets) await evaluate(target, 'setTimeout(()=>location.reload(),250); true');
    }
    return { saved };
  }
  const target = targets.find(t => t.url.includes(projectId));
  if (!target) throw new Error('Requested project is not open: ' + projectId);
  if (command === 'ready') {
    const deadline = Date.now() + 45000;
    let lastError;
    do {
      try {
        return await evaluate(target, `(async()=>{
          const bus=window.top._MSG_BUS2_EXTAPI_;
          if(!bus) throw Error('Editor API not ready');
          const project=await bus.rpcCall('extensionApi.DMT_Project.getCurrentProjectInfo');
          if(project?.uuid!==${JSON.stringify(projectId)}) throw Error('Project not loaded');
          const extensions=await bus.rpcCall('extensionApi.getExtensionsIndex');
          if(!Array.isArray(extensions)) throw Error('Extension database not ready');
          return {ready:true};
        })()`, 5000);
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    throw lastError;
  }
  if (command === 'disable') {
    return evaluate(target, `(async()=>{
      const bus=window.top._MSG_BUS2_EXTAPI_;
      const uuid=${JSON.stringify(config.uuid)};
      try { await bus.rpcCall('extensionApi.setExtensionStatus',{uuid,statusName:'isEnable',status:false}); }
      catch(error) {
        if(!String(error).includes("close code must be")) throw error;
      }
      const item=(await bus.rpcCall('extensionApi.getExtensionsIndex')).find(x=>x.uuid===uuid);
      if(item?.isEnable) throw Error('Old extension is still enabled; import was not attempted.');
      return {disabled:true};
    })()`);
  }
  if (command === 'install') {
    const requested = await evaluate(target, `(async()=>{
      const bus=window.top._MSG_BUS2_EXTAPI_;
      const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c=>c.charCodeAt(0));
      const file=new File([bytes],${JSON.stringify(basename(packageFile))},{type:'application/octet-stream'});
      try { await bus.rpcCall('extensionApi.importExtensionPackages',{files:[file],action:'import'}); }
      catch(error) {
        if(!String(error).includes("close code must be")) throw error;
      }
      return {requested:true};
    })()`, 120000);
    const confirmation = await confirmEasyEdaImportChanges({ port, timeoutMs: 15000 });
    if (confirmation.status === 'unavailable') {
      throw new Error('Apply Changes confirmation was unavailable: ' + JSON.stringify(confirmation));
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    const enabled = await evaluate(target, `(async()=>{
      const bus=window.top._MSG_BUS2_EXTAPI_;
      await bus.rpcCall('extensionApi.setExtensionStatus',{uuid:${JSON.stringify(config.uuid)},statusName:'isEnable',status:true});
      return {enabled:true};
    })()`);
    return { requested, confirmation, enabled };
  }
  if (command !== 'verify') throw new Error('Unknown package operation: ' + command);
  const actual = await evaluate(target, `(async()=>{
    const bus=window.top._MSG_BUS2_EXTAPI_;
    const uuid=${JSON.stringify(config.uuid)};
    const item=(await bus.rpcCall('extensionApi.getExtensionsIndex')).find(x=>x.uuid===uuid);
    if(!item) throw Error('Extension missing after install');
    const file=await bus.rpcCall('extensionApi.getExtensionFile',{uuid,path:'dist/index.js'});
    if(!file) throw Error('Installed entry file is missing');
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return {uuid:item.uuid,version:item.config?.version,enabled:item.isEnable,external:item.isAllowExternalInteractions,entryHash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};
  })()`);
  if (actual.version !== config.version || actual.entryHash !== expectedHash || actual.enabled !== true || actual.external !== true) throw new Error('Installed extension does not match the requested package or is disabled: ' + JSON.stringify(actual));
  return actual;
}
main().then(result=>console.log(JSON.stringify({ok:true,result}))).catch(error=>{console.error(String(error));process.exitCode=1;});
