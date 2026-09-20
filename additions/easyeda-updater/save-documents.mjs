// Runs in the renderer through the same RPCs used by the public extension API.
export async function saveEditorDocuments(rpc) {
  const tree = await rpc('extensionApi.DMT_EditorControl.getSplitScreenTree');
  if (!tree) throw new Error('Cannot inspect open documents; refusing restart.');
  const flatten = node => [...(node.tabs || []), ...(node.children || []).flatMap(flatten)];
  const methods = { 1: 'SCH', 3: 'PCB', 26: 'PNL' };
  const saved = [];
  for (const tab of flatten(tree)) {
    const type = tab.documentType ?? tab.data?.doctype;
    if ([-1, 0, 12, 15, 27].includes(type) || tab.group === 'start_blank') continue;
    if (!methods[type]) throw new Error('Cannot verify save of tab: ' + tab.title);
    const activated = await rpc('extensionApi.DMT_EditorControl.activateDocument', tab.tabId);
    if (!activated) throw new Error('Cannot activate ' + tab.title);
    const result = await rpc('extensionApi.' + methods[type] + '_Document.save', {});
    if (result !== true && result?.success !== true) throw new Error('Save failed: ' + tab.title);
    saved.push(tab.tabId);
  }
  return saved;
}
