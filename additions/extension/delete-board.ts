type BoardRecord = { name: string; schematic?: { uuid: string }; pcb?: { uuid: string } };
type DeleteApi = {
    boards(): Promise<BoardRecord[]>;
    deleteBoard(name: string): Promise<boolean>;
    deleteSchematic(uuid: string): Promise<boolean>;
    deletePcb(uuid: string): Promise<boolean>;
};

// Keep the board association until document cleanup succeeds, so retries retain the IDs.
export async function deleteBoardWithDocuments(name: string, api: DeleteApi) {
    const board = (await api.boards()).find(item => item.name === name);
    if (!board) return { success: false, boardDeleted: false, errors: ['Board not found: ' + name] };
    const errors: string[] = [];
    const remove = async (kind: string, uuid: string | undefined, fn: (uuid: string) => Promise<boolean>) => {
        if (!uuid) return true;
        try {
            const deleted = await fn(uuid);
            if (!deleted) errors.push(`${kind} deletion failed: ${uuid}`);
            return deleted;
        } catch (error) { errors.push(`${kind} ${uuid}: ${String(error)}`); return false; }
    };
    const schematicDeleted = await remove('Schematic', board.schematic?.uuid, api.deleteSchematic);
    const pcbDeleted = await remove('PCB', board.pcb?.uuid, api.deletePcb);
    let boardDeleted = false;
    if (schematicDeleted && pcbDeleted) {
        try {
            // EasyEDA can remove the empty board automatically with its last document.
            boardDeleted = !(await api.boards()).some(item => item.name === name);
            if (!boardDeleted) {
                await api.deleteBoard(name);
                boardDeleted = !(await api.boards()).some(item => item.name === name);
            }
        }
        catch (error) { errors.push(String(error)); }
        if (!boardDeleted) errors.push('Board container deletion failed: ' + name);
    }
    return { success: boardDeleted && schematicDeleted && pcbDeleted, boardDeleted, schematicDeleted, pcbDeleted, schematicUuid: board.schematic?.uuid, pcbUuid: board.pcb?.uuid, errors };
}
