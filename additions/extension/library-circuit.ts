import type { CircuitMod } from '@copilot/shared/types/circuit';
import { checkpointer } from '../../extension/src/eda/checkpointer';
import { readWholeSchematic, validateRemovalTargets } from './schematic-snapshot';
import { getPrimitiveComponentPins } from '../../extension/src/eda/search';
import { getBBox } from '../../extension/src/eda/utils';
import { placeNet, rmNet } from '../../extension/src/eda/place-net';
import { removeComponent } from '../../extension/src/eda/rm-compoment-with-connections';
import type { PlacedComponents, AddedNet } from '../../extension/src/eda/types';

export async function resolveCircuitDevice(component: CircuitMod['add_components'][number]) {
    const library = component.library_uuid || await eda.lib_LibrariesList.getSystemLibraryUuid();
    if (!library) throw new Error('No library specified for ' + component.designator);
    const project = await eda.dmt_Project.getCurrentProjectInfo();
    if (library === 'project' || library === project?.uuid) {
        // Project device.get fails on missing parent_tag in EasyEDA 3.2.149.
        // create accepts the complete search item, preserving its local footprint links.
        const query = component.search_query || component.value || component.part_uuid;
        for (let page = 1; page <= 100; page++) {
            const results = await eda.lib_Device.search(query, 'project', undefined, undefined, 50, page);
            const item = results.find(candidate => candidate.uuid === component.part_uuid);
            if (item) {
                const symbol = await eda.lib_Symbol.get(item.symbolUuid, 'project');
                if (!symbol?.subPartNames?.length) throw new Error('Cannot resolve project symbol: ' + component.designator);
                return { reference: item, subPartName: (symbol.subPartNames as string[])[0] };
            }
            if (results.length < 50) break;
        }
        throw new Error('Exact Project device not found; repeat search and pass its query: ' + component.part_uuid);
    }
    const device = await eda.lib_Device.get(component.part_uuid, library);
    if (!device?.uuid || !device.libraryUuid) throw new Error('Cannot resolve library device: ' + component.designator);
    return { reference: { uuid: device.uuid, libraryUuid: device.libraryUuid }, subPartName: (device.subPartNames as string[] | undefined)?.[0] };
}

// Library devices must be resolved by the editor, not the backend's LCSC-only catalog.
export async function applyLibraryCircuit(circuit: CircuitMod) {
    const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
    if (doc?.documentType !== EDMT_EditorDocumentType.SCHEMATIC_PAGE) throw new Error('Open a schematic page first.');
    if (circuit.add_reused_blocks.length) throw new Error('Reusable blocks are not supported here.');
    const existing = await eda.sch_PrimitiveComponent.getAll();
    const names = new Set(existing.map(c => c.getState_Designator()).filter(name => name && !circuit.rm_components?.includes(name)));
    for (const component of circuit.add_components) {
        if (names.has(component.designator)) throw new Error('Duplicate designator: ' + component.designator);
        names.add(component.designator);
    }
    const before = circuit.external_rm_connect?.length || circuit.rm_components?.length
        ? await readWholeSchematic() : { components: [] };
    validateRemovalTargets(before, circuit.rm_components || []);
    const devices = new Map<string, Awaited<ReturnType<typeof resolveCircuitDevice>>>();
    for (const component of circuit.add_components) {
        devices.set(component.designator, await resolveCircuitDevice(component));
    }
    const current = await eda.dmt_SelectControl.getCurrentDocumentInfo();
    if (current?.uuid !== doc.uuid || current?.parentProjectUuid !== doc.parentProjectUuid) {
        throw new Error('Active schematic changed during device resolution; no edits applied.');
    }
    const checkpoint = await checkpointer.save(false);
    if (!checkpoint) throw new Error('Cannot create schematic checkpoint.');
    const placed: PlacedComponents = {};
    const nets: AddedNet[] = [];
    try {
        for (const connection of circuit.external_rm_connect || []) {
            const pin = before.components.find(c => c.designator === connection.designator)?.pins.find(p => String(p.pin_number) === String(connection.pin_number));
            if (!pin) throw new Error('Connection pin not found: ' + connection.designator);
            await rmNet([{ ...connection, net: pin.signal_name }], placed);
        }
        for (const designator of circuit.rm_components || []) await removeComponent(designator, before);
        const remaining = (await eda.sch_PrimitiveComponent.getAll()).filter(c => c.getState_ComponentType() !== ESCH_PrimitiveComponentType.DRAWING);
        const occupied = remaining.length ? await getBBox(remaining) : undefined;
        let x = occupied ? occupied.maxX + 300 : 300;
        for (const component of circuit.add_components) {
            const device = devices.get(component.designator)!;
            const reference = device.reference;
            // Await the one mutation to completion. A caller timeout must never cause a second create.
            let primitive = await eda.sch_PrimitiveComponent.create(reference, x, 500, device.subPartName, 0, false, true, true);
            if (!primitive) throw new Error('Library device could not be placed: ' + JSON.stringify(reference));
            const originalProperties = primitive.getState_OtherProperty?.() ?? {};
            const catalogProperties = /^[0-9a-f]{32}$/.test(component.part_uuid)
                ? { ...originalProperties, 'Copilot Catalog UUID': component.part_uuid }
                : originalProperties;
            primitive = await primitive
                .setState_Designator(component.designator)
                .setState_Name(component.value)
                .setState_OtherProperty(catalogProperties)
                .done();
            const id = primitive.getState_PrimitiveId();
            const pins = await getPrimitiveComponentPins(id);
            for (const pin of component.pins) {
                if (!pins.some(p => String(p.getState_PinNumber()) === String(pin.pin_number))) throw new Error(`Pin ${pin.pin_number} does not exist on ${component.designator}`);
                if (pin.signal_name) nets.push({ designator: component.designator, pin_number: pin.pin_number, net: pin.signal_name });
            }
            placed[component.designator] = { primitive_id: id, designator: component.designator, pins };
            const box = await getBBox([primitive]);
            if (!box) throw new Error('Cannot measure placed symbol: ' + component.designator);
            x = box.maxX + Math.max(box.width, 300) + 300;
        }
        nets.push(...(circuit.external_connect || []).map(c => ({ designator: c.designator, pin_number: c.pin_number, net: c.signal_name })));
        await placeNet(nets, placed, true);
        const after = nets.length ? await readWholeSchematic() : { components: [] };
        for (const net of nets) {
            const pin = after.components.find(c => c.designator === net.designator)?.pins.find(p => String(p.pin_number) === String(net.pin_number));
            if (pin?.signal_name !== net.net) throw new Error(`Connection verification failed: ${net.designator}.${net.pin_number}`);
        }
        if (!await eda.sch_Document.save()) throw new Error('Schematic save failed.');
        return { checkpoint_id: checkpoint, added: Object.keys(placed), saved: true, next_step: 'Import schematic changes into the PCB.' };
    } catch (error) {
        const restored = await checkpointer.restore(checkpoint, true).catch(() => false);
        throw new Error(`${String(error)}; checkpoint ${checkpoint}; restored=${restored}`);
    }
}
