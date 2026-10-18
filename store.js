// A copy of config.json and the month files on this device, written back to the repo through the
// GitHub API. Changes wait in a queue on the device until they're saved, so logging works without
// signal. If a file changed meanwhile (the laptop, another tab), the newer file is fetched and the
// change applied to it again.

const Store = (() => {
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const API = LOCAL ? location.origin + '/api' : 'https://api.github.com';
  const KEY = { settings: 'dw.settings', files: 'dw.files', queue: 'dw.queue' };

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  const settings = Object.assign({
    repo: 'empyrealfinance-rgb/daily-widget',
    token: '',
    device: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'laptop',
  }, read(KEY.settings, {}));

  let files = read(KEY.files, {});   // path -> { sha, json }
  let queue = read(KEY.queue, []);   // [{ path, op }]
  let status = { state: 'idle', error: '', last: null };
  let version = 0, cached = null, cachedVersion = -1;
  let timer = null, flushing = null, syncing = null;
  const listeners = [];

  // what: 'data' (something to redraw) or 'status' (only the sync line)
  function notify(what) { if (what === 'data') version++; listeners.forEach(f => f(what)); }
  function setStatus(s) { status = Object.assign({}, status, s); notify('status'); }

  function ready() { return LOCAL || !!settings.token; }

  async function call(method, path, body) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (settings.token && !LOCAL) headers.Authorization = 'Bearer ' + settings.token;
    if (body) headers['Content-Type'] = 'application/json';
    const url = `${API}/repos/${settings.repo}/contents/${path}` + (method === 'GET' ? '?ref=main' : '');
    const res = await fetch(url, { method, headers, cache: 'no-store', body: body && JSON.stringify(body) });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch {}
      const e = new Error(res.status === 401 ? 'GitHub did not accept the token' : `GitHub said ${res.status} ${msg}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  async function fetchFile(path) {
    const r = await call('GET', path);
    if (r) files[path] = { sha: r.sha, json: JSON.parse(Core.fromB64(r.content)) };
    else delete files[path];
    write(KEY.files, files);
    version++;
  }

  // Fetch whatever changed since last time: two listings, then only the files whose sha differs.
  async function pull() {
    const [root, data] = await Promise.all([call('GET', ''), call('GET', 'data')]);
    const wanted = [...(root || []), ...(data || [])]
      .filter(f => f.path === 'config.json' || /^data\/\d{4}-\d{2}\.json$/.test(f.path))
      .filter(f => !files[f.path] || files[f.path].sha !== f.sha);
    await Promise.all(wanted.map(f => fetchFile(f.path)));
    return wanted.length;
  }

  function sync() {
    if (!ready()) return Promise.resolve();
    if (syncing) return syncing;
    setStatus({ state: 'syncing' });
    syncing = (async () => {
      try {
        await flush(true);
        if (await pull()) notify('data');
        setStatus({ state: queue.length ? 'waiting' : 'ok', error: '', last: new Date() });
      } catch (e) {
        failed(e);
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  function failed(e) {
    const offline = e instanceof TypeError || navigator.onLine === false;
    setStatus({ state: offline ? 'offline' : 'error', error: offline ? '' : e.message });
  }

  function message(ops) {
    const kinds = { task: 'tasks', note: 'notes', supp: 'supplements', suppNote: 'notes', dayNote: 'day notes', undayNote: 'day notes',
      gymDay: 'gym', gymNote: 'gym', gymEx: 'gym', status: 'archive' };
    const what = [...new Set(ops.map(q => kinds[q.op.type] || q.op.type))].join(', ');
    const dates = [...new Set(ops.map(q => q.op.date))].sort();
    return `${settings.device}: ${what} ${dates.join(', ')}`;
  }

  // config.json takes status changes (archive, restore); the month files take everything else.
  const isConfig = path => path === 'config.json';
  const applyTo = (path, json, op) => (isConfig(path) ? Core.applyConfig(json, op) : Core.apply(json, op));

  // Returns true when the file had changed elsewhere (so the screen should show the merged file).
  async function save(path, ops) {
    for (let attempt = 0; ; attempt++) {
      const base = files[path];
      const json = base ? structuredClone(base.json) : isConfig(path) ? { tasks: [], supplements: [] } : { days: {} };
      ops.forEach(q => applyTo(path, json, q.op));
      try {
        const r = await call('PUT', path, {
          message: message(ops),
          content: Core.toB64(isConfig(path) ? Core.serializeConfig(json) : Core.serialize(json)),
          sha: base ? base.sha : undefined,
          branch: 'main',
        });
        files[path] = { sha: r.content.sha, json };
        write(KEY.files, files);
        version++;
        return attempt > 0;
      } catch (e) {
        // 409: the file changed since we read it; 422: it exists but we had no copy of it
        if ((e.status === 409 || e.status === 422) && attempt < 3) { await fetchFile(path); continue; }
        throw e;
      }
    }
  }

  // Saves every waiting change, one commit per month file.
  function flush(inner) {
    if (flushing) return flushing;
    if (!queue.length || !ready()) return Promise.resolve();
    clearTimeout(timer);
    if (!inner) setStatus({ state: 'syncing' });
    flushing = (async () => {
      let merged = false;
      try {
        while (queue.length) {
          const path = queue[0].path;
          const ops = queue.filter(q => q.path === path);
          if (await save(path, ops)) merged = true;
          queue = queue.filter(q => !ops.includes(q));   // changes made meanwhile stay queued
          write(KEY.queue, queue);
        }
        if (merged) notify('data');
        if (!inner) setStatus({ state: 'ok', error: '', last: new Date() });
      } catch (e) {
        if (inner) throw e;
        failed(e);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  function change(op) {
    queue.push({ path: op.type === 'status' ? 'config.json' : `data/${Core.monthOf(op.date)}.json`, op });
    write(KEY.queue, queue);
    notify('data');
    setStatus({ state: 'waiting' });
    clearTimeout(timer);
    timer = setTimeout(() => flush(), 1500);
  }

  // config.json, waiting changes (archive, restore) included
  function config() {
    return views().config;
  }

  // All months as Core wants them: { "2026-10": {days: {...}}, ... }, waiting changes included.
  function data() {
    return views().data;
  }

  function views() {
    if (cachedVersion === version && cached) return cached;
    const out = {};
    const c = files['config.json'] ? structuredClone(files['config.json'].json) : { tasks: [], supplements: [] };
    for (const path in files) {
      const m = path.match(/^data\/(\d{4}-\d{2})\.json$/);
      if (m) out[m[1]] = structuredClone(files[path].json);
    }
    for (const q of queue) {
      if (isConfig(q.path)) { Core.applyConfig(c, q.op); continue; }
      const m = Core.monthOf(q.op.date);
      Core.apply(out[m] || (out[m] = { days: {} }), q.op);
    }
    cached = { config: c, data: out };
    cachedVersion = version;
    return cached;
  }

  function setSettings(s) {
    Object.assign(settings, s);
    write(KEY.settings, settings);
    files = {};
    write(KEY.files, files);
    notify('data');
    return sync();
  }

  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else if (!status.last || Date.now() - status.last > 30000) sync();
  });

  return {
    LOCAL, settings, ready, sync, flush, change, config, data, setSettings,
    status: () => status,
    waiting: () => queue.length,
    onChange: f => listeners.push(f),
  };
})();
