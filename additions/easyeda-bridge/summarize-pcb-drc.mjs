#!/usr/bin/env node
import { withProxy } from './request-easyeda.mjs';

const args = process.argv.slice(2);
const instanceIndex = args.indexOf('--instance');
let instanceId = process.env.EASYEDA_COPILOT_INSTANCE_ID;
if (instanceIndex >= 0) {
  instanceId = args[instanceIndex + 1];
  if (!instanceId) throw new Error('Missing --instance value.');
}

const result = await withProxy(proxy => proxy.request('check-pcb-drc', { limit: 200 }, instanceId), {
  instanceId,
  timeoutMs: 300000,
});
const categories = [];
const violations = [];
for (const category of result || []) {
  categories.push({ name: category.name, count: category.violation_count, truncated: category.truncated });
  for (const group of category.list || []) {
    for (const violation of group.list || []) {
      violations.push({
        category: category.name,
        group: group.name,
        message: violation.message,
        primitive_ids: violation.primitive_ids || [],
        obj1: violation.obj1 || '',
        obj2: violation.obj2 || '',
        rule_name: violation.rule_name || '',
      });
    }
  }
}
const signatureCounts = {};
for (const item of violations) {
  const signature = `${item.category} | ${item.group} | ${item.rule_name}`;
  signatureCounts[signature] = (signatureCounts[signature] || 0) + 1;
}
console.log(JSON.stringify({
  categories,
  signatureCounts,
  clearance: violations.filter(item => item.category === 'Clearance Error'),
  connection: violations.filter(item => item.category === 'Connection Error'),
  netlist: violations.filter(item => item.category === 'Netlist Error'),
  samplePhysical: violations.filter(item => item.category === 'Physical Error').slice(0, 12),
}, null, 2));
