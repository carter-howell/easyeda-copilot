function textResult(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerExecuteJsControlTools(server, bridge) {
    server.registerTool('interrupt_execute_js', {
        title: 'Interrupt EasyEDA JavaScript',
        description: 'Request cooperative cancellation of the active execute_js script. The interrupt bypasses the EasyEDA command queue. Scripts stop at their next control.throwIfCancelled() checkpoint.',
    }, async () => textResult(await bridge.requestEasyEda(
        'interrupt-execute-js',
        { reason: 'Interrupted by interrupt_execute_js' },
        5_000,
    )));
}
