import { API } from './apiBase.js';
import { authHeaders, ledgerClientId } from './api.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseEvents(chunk, onEvent) {
  const blocks = chunk.split('\n\n');
  const rest = blocks.pop() || '';
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try { onEvent(JSON.parse(data)); } catch { /* ignore malformed event */ }
  }
  return rest;
}

export function startLiveSync(onEvent, onConnection) {
  let stopped = false;
  let retry = 0;
  const mine = ledgerClientId();

  async function loop() {
    while (!stopped) {
      let reader;
      try {
        const res = await fetch(`${API}/state/events`, {
          headers: authHeaders({ Accept: 'text/event-stream' })
        });
        if (res.status === 401 || stopped) return;
        if (!res.ok || !res.body) throw new Error(`sync ${res.status}`);
        retry = 0;
        onConnection?.(true);
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          buf = parseEvents(buf, (msg) => {
            if (msg.origin && msg.origin === mine) return;
            onEvent(msg);
          });
        }
        if (!stopped) onConnection?.(false);
      } catch {
        if (!stopped) onConnection?.(false);
      } finally {
        try { reader?.cancel(); } catch { /* ignore */ }
      }
      if (stopped) return;
      retry = Math.min(retry + 1, 6);
      await sleep(1000 * retry);
    }
  }

  loop();
  return () => { stopped = true; };
}
