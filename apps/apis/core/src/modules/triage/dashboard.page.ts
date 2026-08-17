export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Event Triage</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0d0f12; color: #eef0f3; min-height: 100vh; }
    button, input, select { font: inherit; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.5rem; border-bottom: 1px solid #292d34; position: sticky; top: 0; background: rgba(13,15,18,.94); backdrop-filter: blur(12px); z-index: 5; }
    h1 { margin: 0; font-size: 1.15rem; letter-spacing: -.02em; }
    .status { display: flex; align-items: center; gap: .5rem; color: #9ba3ae; font-size: .82rem; }
    .dot { width: .55rem; height: .55rem; border-radius: 50%; background: #f5a524; }
    .dot.live { background: #45d483; box-shadow: 0 0 0 .25rem rgba(69,212,131,.12); }
    main { padding: 1rem; overflow-x: auto; }
    .board { display: grid; grid-template-columns: repeat(3, minmax(280px, 1fr)); gap: 1rem; min-width: 900px; }
    .column { background: #15181d; border: 1px solid #292d34; border-radius: 14px; min-height: calc(100vh - 7rem); overflow: hidden; }
    .column-head { display: flex; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #292d34; text-transform: capitalize; font-weight: 700; }
    .count { color: #8f98a5; font-variant-numeric: tabular-nums; }
    .items { display: grid; gap: .75rem; padding: .75rem; }
    .empty { color: #707986; text-align: center; padding: 3rem 1rem; font-size: .9rem; }
    article { background: #1c2026; border: 1px solid #303640; border-radius: 11px; padding: .9rem; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
    article.urgent { border-left: 3px solid #ff5d68; }
    article.normal { border-left: 3px solid #6ca8ff; }
    article.low { border-left: 3px solid #7e8792; }
    .meta { display: flex; justify-content: space-between; gap: .5rem; margin-bottom: .65rem; }
    .badge { padding: .18rem .45rem; border-radius: 999px; font-size: .68rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; background: #2b313a; }
    .badge.urgent { background: rgba(255,93,104,.15); color: #ff818a; }
    .badge.normal { background: rgba(108,168,255,.14); color: #8dbbff; }
    .badge.low { color: #aab1bb; }
    time { color: #7f8894; font-size: .73rem; }
    h2 { margin: 0 0 .35rem; font-size: .98rem; line-height: 1.35; }
    .source { color: #9da6b2; font-size: .78rem; margin-bottom: .8rem; }
    .actions { display: flex; gap: .5rem; }
    button { border: 0; border-radius: 8px; padding: .48rem .7rem; cursor: pointer; background: #2b313a; color: #e8ebef; }
    button:hover { background: #39414d; }
    button.ack { background: #d9f99d; color: #19220c; font-weight: 750; }
    button:disabled { opacity: .5; cursor: wait; }
    dialog { border: 1px solid #343a43; border-radius: 14px; background: #171a1f; color: #eef0f3; padding: 1.25rem; width: min(420px, calc(100vw - 2rem)); }
    dialog::backdrop { background: rgba(0,0,0,.75); }
    form { display: grid; gap: .8rem; }
    label { display: grid; gap: .35rem; color: #b8bec7; font-size: .86rem; }
    input { width: 100%; border: 1px solid #343a43; border-radius: 8px; background: #0f1115; color: white; padding: .7rem; }
    .error { color: #ff818a; min-height: 1.25rem; font-size: .82rem; }
    @media (max-width: 700px) { header { padding: 1rem; } main { padding: .75rem; } }
  </style>
</head>
<body>
  <header>
    <h1>Morning triage</h1>
    <div class="status"><span class="dot" id="dot"></span><span id="status">Disconnected</span></div>
  </header>
  <main><div class="board" id="board"></div></main>
  <dialog id="login">
    <form id="login-form" method="dialog">
      <h2>Connect to your events</h2>
      <label>API token<input id="token" type="password" autocomplete="current-password" required></label>
      <label>Your name<input id="actor" value="njabulo" maxlength="120" required></label>
      <div class="error" id="login-error"></div>
      <button class="ack" type="submit">Open triage</button>
    </form>
  </dialog>
  <script type="module">
    const domains = ['career', 'personal', 'unclassified'];
    const items = new Map();
    const board = document.querySelector('#board');
    const login = document.querySelector('#login');
    const status = document.querySelector('#status');
    const dot = document.querySelector('#dot');
    let stopped = false;

    function credentials() {
      return {
        token: sessionStorage.getItem('events.token') || '',
        actor: sessionStorage.getItem('events.actor') || 'njabulo',
      };
    }

    function authHeaders(extra = {}) {
      return { Authorization: 'Bearer ' + credentials().token, ...extra };
    }

    function setStatus(label, live = false) {
      status.textContent = label;
      dot.classList.toggle('live', live);
    }

    function formatTime(value) {
      return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
        .format(new Date(value));
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function render() {
      board.replaceChildren();
      for (const domain of domains) {
        const column = element('section', 'column');
        const domainItems = [...items.values()]
          .filter((item) => item.domain === domain && item.status === 'pending')
          .sort((a, b) => Number(a.id) - Number(b.id));
        const head = element('div', 'column-head');
        head.append(element('span', '', domain), element('span', 'count', String(domainItems.length)));
        const list = element('div', 'items');
        if (domainItems.length === 0) list.append(element('div', 'empty', 'Nothing waiting'));
        for (const item of domainItems) list.append(renderItem(item));
        column.append(head, list);
        board.append(column);
      }
    }

    function renderItem(item) {
      const card = element('article', item.priority);
      const meta = element('div', 'meta');
      meta.append(
        element('span', 'badge ' + item.priority, item.priority),
        element('time', '', formatTime(item.event.occurredAt)),
      );
      const title = element('h2', '', item.event.summary || item.event.type);
      const source = element(
        'div',
        'source',
        [item.event.source, item.event.actor, item.event.subject].filter(Boolean).join(' · '),
      );
      const actions = element('div', 'actions');
      const ack = element('button', 'ack', 'Done');
      const snooze = element('button', '', 'Snooze 1h');
      ack.addEventListener('click', () => act(item, 'ack', ack));
      snooze.addEventListener('click', () => act(item, 'snooze', snooze));
      actions.append(ack, snooze);
      card.append(meta, title, source, actions);
      return card;
    }

    async function act(item, action, button) {
      button.disabled = true;
      try {
        const body = { receiptHandle: item.receiptHandle, actor: credentials().actor };
        if (action === 'snooze') body.delaySeconds = 3600;
        const response = await fetch('/triage/items/' + item.id + '/' + action, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error('Action failed (' + response.status + ')');
        items.delete(item.id);
        render();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    }

    async function loadItems() {
      const response = await fetch('/triage/items', { headers: authHeaders() });
      if (response.status === 401 || response.status === 503) throw new Error('auth');
      if (!response.ok) throw new Error('Could not load triage items');
      const payload = await response.json();
      items.clear();
      for (const item of payload.data) items.set(item.id, item);
      render();
    }

    function applyStreamMessage(message) {
      const item = message.triageItem;
      if (!item) return;
      if (item.status === 'pending') items.set(item.id, item);
      else items.delete(item.id);
      render();
    }

    async function connectStream() {
      let delay = 1000;
      while (!stopped) {
        try {
          setStatus('Connecting');
          const lastEventId = sessionStorage.getItem('events.lastEventId') || '0';
          const response = await fetch('/streams/triage', {
            headers: authHeaders({ 'Last-Event-ID': lastEventId }),
          });
          if (!response.ok || !response.body) throw new Error('Stream refused');
          setStatus('Live', true);
          delay = 1000;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const fields = Object.fromEntries(frame.split('\n')
                .filter((line) => !line.startsWith(':') && line.includes(':'))
                .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trimStart()]));
              if (fields.id) sessionStorage.setItem('events.lastEventId', fields.id);
              if (fields.data) applyStreamMessage(JSON.parse(fields.data));
            }
          }
        } catch (error) {
          setStatus('Reconnecting');
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 15000);
      }
    }

    async function boot() {
      if (!credentials().token) return login.showModal();
      try {
        await loadItems();
        void connectStream();
      } catch (error) {
        if (error.message === 'auth') login.showModal();
        else setStatus(error.message);
      }
    }

    document.querySelector('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      sessionStorage.setItem('events.token', document.querySelector('#token').value);
      sessionStorage.setItem('events.actor', document.querySelector('#actor').value);
      try {
        await loadItems();
        login.close();
        void connectStream();
      } catch {
        document.querySelector('#login-error').textContent = 'Token rejected or not configured';
      }
    });

    render();
    void boot();
  </script>
</body>
</html>`;
