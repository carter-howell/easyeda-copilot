export type EasyEdaImportConfirmation = {
    status: 'applied' | 'not_needed' | 'unavailable';
    method?: 'react-handler' | 'dom-click';
    message?: string;
    errors?: string[];
};

export declare const APPLY_CHANGES_EXPRESSION: string;

export declare function confirmEasyEdaImportChanges(options?: {
    port?: number;
    timeoutMs?: number;
    getTargets?: (port: number) => Promise<Array<{ webSocketDebuggerUrl: string }>>;
    evaluate?: (
        target: { webSocketDebuggerUrl: string },
        expression: string,
        timeoutMs: number,
    ) => Promise<EasyEdaImportConfirmation>;
}): Promise<EasyEdaImportConfirmation>;
