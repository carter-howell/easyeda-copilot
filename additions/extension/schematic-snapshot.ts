import { getSchematic } from '../../extension/src/eda/schematic';

export async function readSchematicPins() {
    const components = (await eda.sch_PrimitiveComponent.getAll())
        .filter(component => component.getState_ComponentType() !== ESCH_PrimitiveComponentType.DRAWING);
    const result = [];
    for (const component of components) {
        const primitiveId = component.getState_PrimitiveId();
        const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
        if (!pins) throw new Error('Cannot read schematic pins: ' + primitiveId);
        result.push({ primitiveId, pins });
    }
    return result;
}

// The base reader intentionally defaults to the selection, not the whole page.
export async function readWholeSchematic() {
    const components = (await eda.sch_PrimitiveComponent.getAll())
        .filter(component => Boolean(component.getState_Designator()?.trim()));
    if (!components.length) return { components: [] };
    return getSchematic(components.map(component => component.getState_PrimitiveId()), {
        disableExtractPartUuid: true,
        disableExtractPos: true,
    });
}

export function validateRemovalTargets(
    snapshot: { components: Array<{ designator: string }> },
    designators: readonly string[],
) {
    const seen = new Set<string>();
    for (const designator of designators) {
        if (seen.has(designator)) throw new Error('Duplicate removal target: ' + designator);
        seen.add(designator);
        if (!snapshot.components.some(component => component.designator === designator)) {
            throw new Error('Removal target missing from full-page snapshot: ' + designator);
        }
    }
}
