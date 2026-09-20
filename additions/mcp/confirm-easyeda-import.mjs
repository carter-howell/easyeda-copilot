import { editorTargets, evaluate } from '../easyeda-updater/cdp.mjs';

export const APPLY_CHANGES_EXPRESSION = `
(async () => {
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const deadline = Date.now() + 12000;

  while (Date.now() < deadline) {
    const button = [...document.querySelectorAll('button, [role="button"]')].find(element => {
      const text = (element.innerText || element.textContent || '').trim();
      if (text !== 'Apply Changes' || element.hasAttribute('disabled')) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    });

    if (button) {
      const propKey = Object.keys(button).find(key => key.startsWith('__reactProps$'));
      const props = propKey ? button[propKey] : undefined;
      if (typeof props?.onClick === 'function') {
        const result = props.onClick({
          type: 'click',
          target: button,
          currentTarget: button,
          preventDefault() {},
          stopPropagation() {},
        });
        if (result && typeof result.then === 'function') await result;
        return { status: 'applied', method: 'react-handler' };
      }

      button.click();
      return { status: 'applied', method: 'dom-click' };
    }

    await sleep(200);
  }

  return { status: 'not_needed' };
})()
`;

function candidatePorts(explicitPort) {
  const values = [
    explicitPort,
    Number(process.env.EASYEDA_REMOTE_DEBUGGING_PORT),
    9223,
    9222,
    9224,
  ];
  return [...new Set(values.filter(value => Number.isInteger(value) && value > 0))];
}

export async function confirmEasyEdaImportChanges(options = {}) {
  const getTargets = options.getTargets ?? editorTargets;
  const runExpression = options.evaluate ?? evaluate;
  const targets = [];
  const errors = [];

  for (const port of candidatePorts(options.port)) {
    try {
      for (const target of await getTargets(port)) {
        if (!targets.some(candidate => candidate.webSocketDebuggerUrl === target.webSocketDebuggerUrl)) {
          targets.push(target);
        }
      }
    } catch (error) {
      errors.push(`${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!targets.length) {
    return {
      status: 'unavailable',
      message: 'No debug-enabled EasyEDA editor renderer was reachable.',
      errors,
    };
  }

  const results = await Promise.allSettled(targets.map(target => (
    runExpression(target, APPLY_CHANGES_EXPRESSION, options.timeoutMs ?? 15_000)
  )));
  const applied = results.find(result => (
    result.status === 'fulfilled' && result.value?.status === 'applied'
  ));
  if (applied?.status === 'fulfilled') return applied.value;

  const fulfilled = results.find(result => result.status === 'fulfilled');
  if (fulfilled?.status === 'fulfilled') return fulfilled.value;

  return {
    status: 'unavailable',
    message: 'EasyEDA renderer evaluation failed.',
    errors: results.map(result => (
      result.status === 'rejected'
        ? result.reason instanceof Error ? result.reason.message : String(result.reason)
        : String(result.value)
    )),
  };
}
