import { WebSocket } from 'ws';

export async function editorTargets(port = 9222) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Cannot list EasyEDA editor targets');
  return (await response.json()).filter(t => t.type === 'page' && /^(https:\/\/pro\.easyeda\.com\/editor|https:\/\/client\/editor\b)/.test(t.url));
}

export function evaluate(target, expression, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => finish(new Error('EasyEDA evaluation timed out; completion is unconfirmed.')), timeoutMs);
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(value);
    }
    ws.on('error', error => finish(error));
    ws.on('close', () => finish(new Error('EasyEDA disconnected during evaluation.')));
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs } })));
    ws.on('message', data => {
      try {
        const message = JSON.parse(String(data));
        if (message.id !== 1) return;
        const exception = message.result?.exceptionDetails;
        if (message.error || exception) return finish(new Error(exception?.exception?.description || exception?.text || JSON.stringify(message.error)));
        finish(null, message.result?.result?.value);
      } catch (error) { finish(error); }
    });
  });
}
