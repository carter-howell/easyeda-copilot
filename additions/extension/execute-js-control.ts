type ActiveExecution = {
    id: number;
    startedAt: number;
    cancelRequested: boolean;
    reason: string;
};

export type ExecuteJsControl = {
    readonly executionId: number;
    readonly cancelled: boolean;
    throwIfCancelled(): void;
};

export type ExecuteJsExecution = {
    control: ExecuteJsControl;
    finish(): void;
};

let sequence = 0;
let active: ActiveExecution | undefined;

function controlFor(execution: ActiveExecution): ExecuteJsControl {
    return {
        executionId: execution.id,
        get cancelled() { return execution.cancelRequested; },
        throwIfCancelled() {
            if (execution.cancelRequested) {
                throw new Error(`JavaScript execution interrupted: ${execution.reason}`);
            }
        },
    };
}

/** Start cooperative cancellation for the upstream executor without replacing checkpoint scopes. */
export function beginJavaScriptExecution(): ExecuteJsExecution {
    const execution: ActiveExecution = {
        id: ++sequence,
        startedAt: Date.now(),
        cancelRequested: false,
        reason: 'Interrupted by MCP client',
    };
    active = execution;
    return {
        control: controlFor(execution),
        finish() {
            if (active === execution) active = undefined;
        },
    };
}

export function interruptJavaScriptExecution(reason = 'Interrupted by MCP client') {
    if (!active) return { interrupted: false, status: 'idle' as const };
    active.cancelRequested = true;
    active.reason = reason;
    return {
        interrupted: true,
        status: 'cancel_requested' as const,
        executionId: active.id,
        startedAt: active.startedAt,
    };
}
