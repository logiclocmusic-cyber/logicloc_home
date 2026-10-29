const clients = new Set();
const editors = new Map();
const EDITOR_TTL_MS = 25000;

export function subscribe(res, id) {
  const client = { res, id: id || '' };
  clients.add(client);
  return () => {
    clients.delete(client);
    if (client.id && editors.delete(client.id)) publishPresence();
  };
}

export function publish(event) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(chunk);
    } catch {
      clients.delete(client);
    }
  }
}

function activeEditors(exceptId) {
  const now = Date.now();
  const pages = [];
  for (const [id, info] of editors) {
    if (now - info.at > EDITOR_TTL_MS) {
      editors.delete(id);
      continue;
    }
    if (id && id === exceptId) continue;
    pages.push(info.page || '账本');
  }
  return pages;
}

export function publishPresence() {
  for (const client of clients) {
    const chunk = `data: ${JSON.stringify({ topic: 'presence', pages: activeEditors(client.id) })}\n\n`;
    try {
      client.res.write(chunk);
    } catch {
      clients.delete(client);
    }
  }
}

export function setEditor(id, page) {
  if (!id) return;
  const name = String(page || '').trim().slice(0, 20);
  if (!name) editors.delete(id);
  else editors.set(id, { page: name, at: Date.now() });
  publishPresence();
}
