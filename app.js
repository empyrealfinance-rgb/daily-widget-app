// The screens: days (the grid), log (supplements, how you feel), gym (sets).
// Drawn from Store's data with Core's rules; every change goes through Store.change().

(() => {
  const $ = sel => document.querySelector(sel);
  const main = $('#main'), sheetEl = $('#sheet'), statusEl = $('#status');

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pretty = d => { const x = Core.parse(d); return `${WD[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
  const rel = d => {
    const n = Core.diffDays(d, Core.today());
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? `${n} days ago` : pretty(d);
  };

  // ---- Sets: [kg, reps]; kg null = bodyweight, reps null = not written down
  const kgText = k => (k == null ? 'BW' : String(k));
  const parseKg = s => { s = String(s).trim().replace(',', '.'); const n = parseFloat(s); return s === '' || isNaN(n) ? null : n; };
  // "45 × 10, 10, 8 · 47.5 × 8": consecutive sets with the same weight share it, like the Telegram notes
  function fmtSets(sets) {
    const groups = [];
    for (const [k, r] of sets) {
      const g = groups[groups.length - 1];
      if (g && g.k === k) g.r.push(r ?? '?'); else groups.push({ k, r: [r ?? '?'] });
    }
    return groups.map(g => `${kgText(g.k)} × ${g.r.join(', ')}`).join(' · ');
  }

  // ---- What the screens remember: the tab survives a reload, the rest doesn't
  const ui = { tab: 'days', logDate: Core.today(), gymDate: Core.today(), ex: null, picking: false, search: '', next: null, armed: -1, feel: '' };
  try { ui.tab = localStorage.getItem('dw.tab') || 'days'; } catch {}

  function go(tab) {
    ui.tab = tab;
    try { localStorage.setItem('dw.tab', tab); } catch {}
    render();
  }

  // ---- Drawing

  let deferred = false;
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName); };

  function render() {
    deferred = false;
    $('#title').textContent = pretty(Core.today());
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    if (!Store.ready()) main.innerHTML = setupView();
    else if (!Store.config().tasks.length) main.innerHTML = `<p class="muted narrow">${Store.status().state === 'error' ? esc(Store.status().error) : 'Loading…'}</p>`;
    else main.innerHTML = ui.tab === 'log' ? logView() : ui.tab === 'gym' ? gymView() : daysView();
    renderStatus();
  }

  function renderStatus() {
    const st = Store.status(), n = Store.waiting();
    let text = '';
    if (!Store.ready()) text = 'set up';
    else if (st.state === 'error') text = 'sync problem';
    else if (st.state === 'offline') text = n ? `offline · ${n} waiting` : 'offline';
    else if (n || st.state === 'syncing') text = 'saving…';
    else if (st.state === 'ok') text = 'saved';
    statusEl.textContent = text;
    statusEl.classList.toggle('problem', st.state === 'error');
  }

  function setupView() {
    return `<div class="card narrow"><h3>Connect to GitHub</h3>
      <p class="muted">This app keeps your data in your private daily-widget repo. It needs a token for that repo, once per device.</p>
      <button class="btn primary" data-act="settings">Open settings</button></div>`;
  }

  // ---- Days: tasks as rows, days as columns, today on the right

  const LABEL = 116, GAP = 4;
  function fitDays() {
    const w = Math.min(main.clientWidth || window.innerWidth, 1100) - 32;
    const n = Math.max(7, Math.min(60, Math.floor((w - LABEL) / (34 + GAP))));
    const cell = Math.max(24, Math.min(34, Math.floor((w - LABEL - n * GAP) / n)));
    return { n, cell };
  }

  function daysView() {
    const cfg = Store.config(), data = Store.data(), now = Core.today();
    const { n, cell } = fitDays();
    const dates = Array.from({ length: n }, (_, i) => Core.addDays(now, i - n + 1));
    const rows = Core.rows(cfg, data, dates, now).filter(r => r.cells.some(c => c.state !== 'none' && c.state !== 'off'));
    const head = '<div></div>' + dates.map(d => {
      const x = Core.parse(d);
      return `<div class="dh${d === now ? ' today' : ''}"><span>${'SMTWTFS'[x.getDay()]}</span>${x.getDate()}</div>`;
    }).join('');
    const row = r =>
      `<div class="lab${r.optional ? ' opt' : ''}"><span class="name">${esc(r.name)}</span>${r.hint ? `<span class="hint">${esc(r.hint)}</span>` : ''}</div>` +
      r.cells.map(c => cellHtml(r, c)).join('');
    const must = rows.filter(r => !r.optional), opt = rows.filter(r => r.optional);
    return `<div class="grid" style="--n:${n};--cell:${cell}px;--label:${LABEL}px">${head}${must.map(row).join('')}` +
      (opt.length ? `<div class="sec">optional</div>${opt.map(row).join('')}` : '') + '</div>';
  }

  function cellHtml(r, c) {
    if (c.state === 'none' || c.state === 'off') return `<span class="sq"></span>`;
    const tip = `${r.name} · ${pretty(c.date)}${c.note ? '\n' + c.note : ''}`;
    return `<button class="sq s-${c.state}${r.optional ? ' opt' : ''}${c.note ? ' noted' : ''}" data-task="${r.id}" data-date="${c.date}" title="${esc(tip)}"></button>`;
  }

  function tapCell(id, date) {
    const task = Store.config().tasks.find(t => t.id === id);
    if (task.kind === 'gym') { ui.gymDate = date; ui.ex = null; ui.picking = false; return go('gym'); }
    Store.change({ type: 'task', date, id, done: !Core.isDone(task, Store.data(), date) });
  }

  function recentNotes(id) {
    const data = Store.data(), out = [];
    for (const m of Object.keys(data).sort().reverse()) {
      const days = data[m].days || {};
      for (const d of Object.keys(days).sort().reverse()) {
        const note = days[d].tasks && days[d].tasks[id] && days[d].tasks[id].note;
        if (note && !out.includes(note)) out.push(note);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }

  function openNote(id, date) {
    const task = Store.config().tasks.find(t => t.id === id);
    const e = Core.entryOf(task, Store.data(), date);
    const recent = recentNotes(id);
    sheet(`<h3>${esc(task.name)} <span class="muted small">${pretty(date)}</span></h3>
      <textarea id="note" rows="3" placeholder="what happened (used laptop 15 min, work only)">${esc(e && e.note)}</textarea>
      ${recent.length ? `<div class="chips">${recent.map(n => `<button class="chip" data-act="chip">${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="row end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save">Save</button></div>`, {
      chip: el => { $('#note').value = el.textContent; },
      save: () => { Store.change({ type: 'note', date, id, text: $('#note').value.trim() }); closeSheet(); },
    });
  }

  // ---- Log: supplements (one tap) and how you feel, each with the time

  function logView() {
    const cfg = Store.config(), d = ui.logDate;
    const log = (Core.dayOf(Store.data(), d) || {}).log || [];
    const sups = (cfg.supplements || []).filter(s => Core.statusOn(s, d) === 'active');
    const supBtn = s => {
      const taken = log.filter(e => e.kind === 'supplement' && e.item === s.id);
      return `<button class="sup${taken.length ? ' taken' : ''}" data-sup="${s.id}"><span>${esc(s.name)}</span>
        <small>${taken.length ? '✓ ' + taken.map(e => e.t).join(', ') : esc(s.dose)}</small></button>`;
    };
    return `<div class="narrow">${datebar(d)}
      ${sups.length ? `<h4>Supplements</h4><div class="sups">${sups.map(supBtn).join('')}</div>` : ''}
      <h4>How do you feel?</h4>
      <textarea id="feel" rows="3" placeholder="energy, mood, body, sleep…">${esc(ui.feel)}</textarea>
      <div class="row end"><button class="btn primary" data-act="feel">Save</button></div>
      <div class="timeline">${log.map(e => `<button class="entry" data-entry="${e.id}"><span class="t">${e.t}</span><span class="x">${esc(entryText(e))}</span></button>`).join('')}</div>
    </div>`;
  }

  function entryText(e) {
    if (e.kind === 'supplement') {
      const s = (Store.config().supplements || []).find(x => x.id === e.item);
      return `${s ? s.name : e.item} ${e.dose || ''}`.trim();
    }
    return e.text || '';
  }

  function datebar(d) {
    const now = Core.today();
    return `<div class="datebar"><button data-nav="-1" aria-label="Day before">‹</button>
      <span>${pretty(d)}${d === now ? ' · today' : ''}</span>
      <button data-nav="1" aria-label="Day after"${d >= now ? ' disabled' : ''}>›</button></div>`;
  }

  function addSupplement(id, dose) {
    const s = Store.config().supplements.find(x => x.id === id);
    Store.change({ type: 'log', date: ui.logDate, entry: { id: Core.newId(), t: Core.hhmm(), kind: 'supplement', item: id, dose: dose || s.dose } });
  }

  function supplementSheet(id) {
    const s = Store.config().supplements.find(x => x.id === id);
    sheet(`<h3>${esc(s.name)}</h3>
      <label>Dose<input id="dose" value="${esc(s.dose)}"></label>
      <div class="row end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="add">Add</button></div>`, {
      add: () => { addSupplement(id, $('#dose').value.trim()); closeSheet(); },
    });
  }

  function entrySheet(entryId) {
    const d = ui.logDate, e = ((Core.dayOf(Store.data(), d) || {}).log || []).find(x => x.id === entryId);
    if (!e) return;
    const isSup = e.kind === 'supplement';
    sheet(`<h3>${isSup ? esc(entryText(e)) : 'How you felt'} <span class="muted small">${pretty(d)}</span></h3>
      <label>Time<input id="t" type="time" value="${e.t}"></label>
      ${isSup ? `<label>Dose<input id="val" value="${esc(e.dose)}"></label>` : `<label>Note<textarea id="val" rows="4">${esc(e.text)}</textarea></label>`}
      <div class="row end"><button class="btn danger" data-act="del">Delete</button>${isSup ? '<button class="btn" data-act="again">Take again</button>' : ''}<button class="btn primary" data-act="save">Save</button></div>`, {
      del: () => { Store.change({ type: 'unlog', date: d, id: e.id }); closeSheet(); },
      again: () => { addSupplement(e.item, e.dose); closeSheet(); },
      save: () => {
        const v = $('#val').value.trim();
        Store.change({ type: 'log', date: d, entry: Object.assign({}, e, { t: $('#t').value || e.t }, isSup ? { dose: v } : { text: v }) });
        closeSheet();
      },
    });
  }

  // ---- Gym: the day's exercises; pick one (recent first), last time's sets prefilled, add sets

  // name -> [{date, sets, note}], oldest first
  function gymHistory() {
    const data = Store.data(), out = {};
    for (const m of Object.keys(data).sort()) {
      const days = data[m].days || {};
      for (const d of Object.keys(days).sort()) {
        for (const e of (days[d].gym && days[d].gym.ex) || []) (out[e.name] = out[e.name] || []).push({ date: d, sets: e.sets, note: e.note });
      }
    }
    return out;
  }
  const previous = (name, date) => (gymHistory()[name] || []).filter(x => x.date < date).pop() || null;
  const gymDay = d => (Core.dayOf(Store.data(), d) || {}).gym || null;
  const exOf = (d, name) => ((gymDay(d) || {}).ex || []).find(e => e.name === name) || null;

  function gymView() {
    if (ui.ex) return exerciseView();
    if (ui.picking) return pickerView();
    const d = ui.gymDate, gym = gymDay(d), ex = (gym && gym.ex) || [];
    return `<div class="narrow">${datebar(d)}
      ${ex.map(e => `<button class="exrow" data-ex="${esc(e.name)}">${esc(e.name)}<small>${esc(fmtSets(e.sets))}${e.note ? ' · ' + esc(e.note) : ''}</small></button>`).join('')}
      <button class="btn wide primary big" data-act="pick">+ exercise</button>
      <h4>Note</h4>
      <input id="gnote" placeholder="sleep, food, how it went" value="${esc(gym && gym.note)}">
      ${!gym ? '<button class="btn wide" data-act="went">Went, no details</button>' : !ex.length ? '<button class="btn wide" data-act="notgym">Not a gym day</button>' : ''}
    </div>`;
  }

  function pickerView() {
    return `<div class="narrow"><div class="row"><button class="back" data-act="back" aria-label="Back">‹</button>
      <input id="search" placeholder="find or add an exercise" autocomplete="off" autocapitalize="off" value="${esc(ui.search)}"></div>
      <div id="picklist">${pickList()}</div></div>`;
  }

  function pickList() {
    const hist = gymHistory(), d = ui.gymDate, q = ui.search.trim().toLowerCase();
    const list = Object.keys(hist).map(name => {
      const before = hist[name].filter(x => x.date < d).pop();
      const last = before || hist[name][hist[name].length - 1];
      return { name, last, today: hist[name].some(x => x.date === d) };
    }).sort((a, b) => (a.last.date < b.last.date ? 1 : a.last.date > b.last.date ? -1 : 0));
    const shown = q ? list.filter(e => e.name.includes(q)) : list;
    const add = q && !list.some(e => e.name === q) ? `<button class="pick new" data-pick="${esc(q)}">+ add “${esc(q)}”</button>` : '';
    return add + shown.map(e => `<button class="pick" data-pick="${esc(e.name)}">${esc(e.name)}${e.today ? '<span class="badge">today</span>' : ''}
      <small>${rel(e.last.date)} · ${esc(fmtSets(e.last.sets))}</small></button>`).join('');
  }

  // Next set: the same set from last time, else today's last set, else last time's last set
  function prefill(sets, prev) {
    const i = sets.length;
    if (prev && prev.sets[i]) return prev.sets[i];
    if (sets.length) return sets[sets.length - 1];
    if (prev && prev.sets.length) return prev.sets[prev.sets.length - 1];
    return [null, 10];
  }

  function exerciseView() {
    const name = ui.ex, d = ui.gymDate, e = exOf(d, name), sets = (e && e.sets) || [];
    const prev = previous(name, d);
    const next = ui.next || prefill(sets, prev);
    return `<div class="narrow"><div class="row"><button class="back" data-act="back" aria-label="Back">‹</button><h3 style="margin:0">${esc(name)}</h3></div>
      <p class="muted small">${prev ? `last time, ${rel(prev.date)}: ${esc(fmtSets(prev.sets))}${prev.note ? ' · ' + esc(prev.note) : ''}` : 'first time'}</p>
      <ol class="sets">${sets.map((s, i) => `<li><span><span class="n">${i + 1}</span>${kgText(s[0])} × ${s[1] ?? '?'}</span>
        <button class="del${ui.armed === i ? ' armed' : ''}" data-del="${i}">${ui.armed === i ? 'delete?' : '✕'}</button></li>`).join('')}</ol>
      <div class="steppers">
        <div class="stepper"><label>kg (BW = bodyweight)</label><div class="ctl"><button data-step="kg,-1">−</button>
          <input id="kg" inputmode="decimal" value="${kgText(next[0])}"><button data-step="kg,1">+</button></div></div>
        <div class="stepper"><label>reps</label><div class="ctl"><button data-step="reps,-1">−</button>
          <input id="reps" inputmode="numeric" value="${next[1] ?? ''}"><button data-step="reps,1">+</button></div></div>
      </div>
      <button class="btn wide primary big" data-act="addset">Add set ${sets.length + 1}</button>
      ${sets.length ? `<h4>Note</h4><input id="exnote" placeholder="form, pain, machine" value="${esc(e.note)}">` : ''}
    </div>`;
  }

  function step(field, dir) {
    const el = $('#' + field);
    if (field === 'kg') {
      const k = parseKg(el.value) ?? 0;
      el.value = kgText(Math.round((k + dir * 2.5) * 100) / 100);
    } else {
      el.value = Math.max(0, (parseInt(el.value, 10) || 0) + dir);
    }
    ui.next = [parseKg($('#kg').value), parseInt($('#reps').value, 10)];
  }

  function addSet() {
    const d = ui.gymDate, e = exOf(d, ui.ex);
    const reps = parseInt($('#reps').value, 10);
    const sets = ((e && e.sets) || []).concat([[parseKg($('#kg').value), isNaN(reps) ? null : reps]]);
    Store.change({ type: 'gymEx', date: d, name: ui.ex, sets });
    ui.next = null;
    ui.armed = -1;
    render();
  }

  function deleteSet(i) {
    if (ui.armed !== i) { ui.armed = i; render(); setTimeout(() => { if (ui.armed === i) { ui.armed = -1; render(); } }, 3000); return; }
    const d = ui.gymDate, e = exOf(d, ui.ex);
    Store.change({ type: 'gymEx', date: d, name: ui.ex, sets: e.sets.filter((_, j) => j !== i), note: e.note });
    ui.armed = -1;
    render();
  }

  // ---- Settings

  function openSettings() {
    const s = Store.settings, st = Store.status();
    const last = st.last ? `Last synced ${Core.hhmm(new Date(st.last))}.` : '';
    sheet(`<h3>Settings</h3>
      ${Store.LOCAL ? '<p class="muted small">Local test server: no token needed, data stays on this PC.</p>' : `
      <label>GitHub token<input id="token" type="password" autocomplete="off" value="${esc(s.token)}" placeholder="github_pat_…"></label>
      <p class="muted small">A fine-grained token with access to the daily-widget repo only, permission Contents: read and write.
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create one on GitHub</a></p>`}
      <label>This device<input id="device" value="${esc(s.device)}"></label>
      <p class="muted small">${st.error ? esc(st.error) + '. ' : ''}${last} ${Store.waiting() ? Store.waiting() + ' changes waiting.' : ''}</p>
      <div class="row end"><button class="btn" data-act="sync">Sync now</button><button class="btn primary" data-act="save">Save</button></div>`, {
      sync: () => { Store.sync(); closeSheet(); },
      save: () => {
        const tok = $('#token');
        Store.setSettings({ device: $('#device').value.trim() || s.device, ...(tok ? { token: tok.value.trim() } : {}) });
        closeSheet();
        render();
      },
    });
  }

  // ---- Bottom sheet

  let actions = {};
  function sheet(html, acts) {
    actions = acts || {};
    sheetEl.innerHTML = `<div class="panel">${html}</div>`;
    sheetEl.hidden = false;
  }
  function closeSheet() {
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
    if (deferred) render();
  }
  sheetEl.addEventListener('click', ev => {
    if (ev.target === sheetEl) return closeSheet();
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'close') closeSheet();
    else if (actions[b.dataset.act]) actions[b.dataset.act](b);
  });

  // ---- Taps: a short tap acts, a long press (or right-click) opens the note or details

  let press = null;
  main.addEventListener('pointerdown', ev => {
    const t = ev.target.closest('[data-task], [data-sup]');
    if (!t) return;
    press = { el: t, x: ev.clientX, y: ev.clientY, long: false };
    press.timer = setTimeout(() => { press.long = true; longPress(t); }, 450);
  });
  const cancelPress = () => { if (press) clearTimeout(press.timer); };
  main.addEventListener('pointermove', ev => { if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancelPress(); });
  main.addEventListener('pointerup', cancelPress);
  main.addEventListener('pointercancel', cancelPress);
  main.addEventListener('contextmenu', ev => {
    const t = ev.target.closest('[data-task], [data-sup]');
    if (!t) return;
    ev.preventDefault();
    cancelPress();
    if (!press || !press.long) longPress(t);
  });

  function longPress(t) {
    if (t.dataset.task) openNote(t.dataset.task, t.dataset.date);
    else supplementSheet(t.dataset.sup);
  }

  main.addEventListener('click', ev => {
    const el = ev.target.closest('button');
    if (!el) return;
    if (press && press.long && press.el === el) { press = null; return; }
    press = null;
    const ds = el.dataset;
    if (ds.task) return tapCell(ds.task, ds.date);
    if (ds.sup) {
      const log = (Core.dayOf(Store.data(), ui.logDate) || {}).log || [];
      const taken = log.filter(e => e.kind === 'supplement' && e.item === ds.sup).pop();
      return taken ? entrySheet(taken.id) : addSupplement(ds.sup);
    }
    if (ds.entry) return entrySheet(ds.entry);
    if (ds.nav) {
      const key = ui.tab === 'log' ? 'logDate' : 'gymDate';
      const d = Core.addDays(ui[key], +ds.nav);
      if (d <= Core.today()) { ui[key] = d; render(); }
      return;
    }
    if (ds.ex) { ui.ex = ds.ex; ui.next = null; ui.armed = -1; return render(); }
    if (ds.pick) { ui.ex = ds.pick.trim().toLowerCase(); ui.picking = false; ui.search = ''; ui.next = null; ui.armed = -1; return render(); }
    if (ds.step) { const [f, dir] = ds.step.split(','); return step(f, +dir); }
    if (ds.del) return deleteSet(+ds.del);
    switch (ds.act) {
      case 'settings': return openSettings();
      case 'feel': {
        const text = $('#feel').value.trim();
        if (!text) return;
        Store.change({ type: 'log', date: ui.logDate, entry: { id: Core.newId(), t: Core.hhmm(), kind: 'feeling', text } });
        ui.feel = '';
        $('#feel').value = '';
        $('#feel').blur();
        return render();
      }
      case 'pick': ui.picking = true; ui.search = ''; return render();
      case 'back': if (ui.ex) ui.ex = null; else ui.picking = false; ui.next = null; return render();
      case 'addset': return addSet();
      case 'went': return Store.change({ type: 'gymDay', date: ui.gymDate, on: true });
      case 'notgym': return Store.change({ type: 'gymDay', date: ui.gymDate, on: false });
    }
  });

  main.addEventListener('input', ev => {
    if (ev.target.id === 'search') { ui.search = ev.target.value; $('#picklist').innerHTML = pickList(); }
    if (ev.target.id === 'feel') ui.feel = ev.target.value;
    if (ev.target.id === 'kg' || ev.target.id === 'reps') ui.next = [parseKg($('#kg').value), parseInt($('#reps').value, 10)];
  });
  main.addEventListener('change', ev => {
    const id = ev.target.id, d = ui.gymDate;
    if (id === 'gnote') Store.change({ type: 'gymNote', date: d, text: ev.target.value.trim() });
    if (id === 'exnote') { const e = exOf(d, ui.ex); if (e) Store.change({ type: 'gymEx', date: d, name: ui.ex, sets: e.sets, note: ev.target.value.trim() }); }
  });
  main.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'search' && ui.search.trim()) {
      const first = $('#picklist [data-pick]');
      if (first) first.click();
    } else if (ev.target.id === 'kg' || ev.target.id === 'reps') addSet();
    else if (ev.target.id === 'gnote' || ev.target.id === 'exnote') ev.target.blur();
  });
  document.addEventListener('focusout', () => setTimeout(() => { if (deferred && !typing() && sheetEl.hidden) render(); }, 0));

  $('#tabs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === 'gym' && ui.tab === 'gym') { ui.ex = null; ui.picking = false; }   // gym again: back to the day
    go(b.dataset.tab);
  });
  $('#gear').addEventListener('click', openSettings);
  statusEl.addEventListener('click', () => (Store.ready() && Store.status().state !== 'error' ? Store.sync() : openSettings()));

  Store.onChange(what => {
    if (what === 'status') return renderStatus();
    if (typing() || !sheetEl.hidden) { deferred = true; renderStatus(); return; }
    render();
  });

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (ui.tab === 'days' && !typing()) render(); }, 150); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Back after midnight: move "today" along
    const now = Core.today();
    if (ui.logDate < now && ui.logDate === Core.addDays(now, -1)) ui.logDate = now;
    if (ui.gymDate < now && ui.gymDate === Core.addDays(now, -1) && !ui.ex) ui.gymDate = now;
    if (!typing()) render();
  });

  render();
  Store.sync();
  if ('serviceWorker' in navigator && !Store.LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
