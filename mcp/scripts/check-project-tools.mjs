import assert from 'node:assert/strict';
import {
    CreateDocInputSchema,
    DeleteDocInputSchema,
    OpenDocumentInputSchema,
    createDoc,
    openDocument,
    registerDocsTools,
    saveDoc,
} from '../dist/tools/docs.js';
import { getAllProjects, registerProjectTools } from '../dist/tools/projects.js';

const requests = [];
const bridge = {
    async requestEasyEda(event, body = {}) {
        requests.push({ event, body });
        return { event, body };
    },
};

const registeredTools = [];
const server = {
    registerTool(name) {
        registeredTools.push(name);
    },
};
registerDocsTools(server, bridge);
registerProjectTools(server, bridge);
assert.equal(registeredTools.includes('create_project'), false);
assert.equal(registeredTools.includes('open_project'), false);
assert.equal(registeredTools.includes('create_doc'), true);
assert.equal(registeredTools.includes('open_document'), true);
assert.equal(registeredTools.includes('save_doc'), true);
assert.equal(registeredTools.includes('delete_doc'), true);
assert.equal(registeredTools.includes('get_all_projects'), true);

assert.equal(OpenDocumentInputSchema.safeParse({}).success, false);
assert.equal(OpenDocumentInputSchema.safeParse({
    document_uuid: 'document-1',
    project_uuid: 'project-1',
}).success, false);
assert.equal(OpenDocumentInputSchema.safeParse({ project_uuid: 'project-1' }).success, true);
assert.equal(CreateDocInputSchema.safeParse({
    doc: { doc_type: 'project', project_friendly_name: '   ' },
}).success, false);
assert.deepEqual(
    DeleteDocInputSchema.parse({ doc: { board_name: 'Temporary' } }),
    { doc: { board_name: 'Temporary', delete_linked_documents: false } },
);
assert.deepEqual(
    DeleteDocInputSchema.parse({
        doc: { board_name: 'Temporary', delete_linked_documents: true },
    }),
    { doc: { board_name: 'Temporary', delete_linked_documents: true } },
);
assert.equal(DeleteDocInputSchema.safeParse({
    doc: { uuid: 'schematic-1', delete_linked_documents: true },
}).success, false);
assert.equal(DeleteDocInputSchema.safeParse({
    doc: { uuid: 'schematic-1', board_name: 'Temporary' },
}).success, false);
assert.equal(CreateDocInputSchema.safeParse({
    doc: {
        doc_type: 'project',
        project_friendly_name: 'Controller',
        team_uuid: '   ',
    },
}).success, false);
assert.equal(CreateDocInputSchema.safeParse({
    doc: {
        doc_type: 'project',
        project_friendly_name: 'Controller',
        project_name: 'controller_1',
    },
}).success, false);

await createDoc(bridge, {
    doc: {
        doc_type: 'project',
        project_friendly_name: 'Controller',
        project_name: 'controller-1',
        team_uuid: 'team-1',
        folder_uuid: 'folder-1',
        description: 'Controller board',
    },
});
await openDocument(bridge, { document_uuid: 'document-uuid' });
await openDocument(bridge, { project_uuid: 'project-uuid' });
await saveDoc(bridge);
await getAllProjects(bridge);

assert.deepEqual(requests, [
    {
        event: 'create-project',
        body: {
            projectFriendlyName: 'Controller',
            projectName: 'controller-1',
            teamUuid: 'team-1',
            folderUuid: 'folder-1',
            description: 'Controller board',
        },
    },
    {
        event: 'open-document',
        body: { documentUuid: 'document-uuid' },
    },
    {
        event: 'open-project',
        body: { projectUuid: 'project-uuid' },
    },
    {
        event: 'save-document',
        body: {},
    },
    {
        event: 'get-all-projects',
        body: {},
    },
]);

const failingBridge = {
    requestEasyEda() {
        return Promise.reject(new Error('EasyEDA failure'));
    },
};

await assert.rejects(
    openDocument(failingBridge, { project_uuid: 'project-uuid' }),
    /EasyEDA failure/,
);
await assert.rejects(saveDoc(failingBridge), /EasyEDA failure/);

console.log('Project/document tool checks passed.');
