// One page: tasks and supplements as ledgers, weeks Monday to Sunday. A box with a note gets a small
// dot in its corner; the note itself stays out of sight.
//   click a box                                   done / not done (gym: the gym panel; supplement: taken now);
//                                                 unticking an earlier day asks first
//   right-click, Ctrl/Alt+click, long-press a box its note (Enter saves, Esc closes)
//   click a date                                  that day's note (what it went into, how it went)
//   click a name                                  rename it (Enter saves), Archive
//   +                                             a new task or supplement
// Under them, today: the day as a line (sleep, screen time, client work from the laptop's time
// tracker) and the day's note, written in place.
// Drawn from Store's data with Core's rules; every change goes through Store.change().

(() => {
  const $ = sel => document.querySelector(sel);
  const main = $('#main'), pop = $('#pop'), sheetEl = $('#sheet'), statusEl = $('#status');

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pretty = d => { const x = Core.parse(d); return `${WD[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
  const rel = d => {
    const n = Core.diffDays(d, Core.today());
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? `${n} days ago` : pretty(d);
  };

  // A color per task, or the classic green for all (settings)
  const GREEN = '#4b8458';
  const prefs = { colors: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('dw.prefs') || '{}')); } catch {}
  const savePrefs = () => { try { localStorage.setItem('dw.prefs', JSON.stringify(prefs)); } catch {} };
  const colorOf = item => (prefs.colors && item.color) || GREEN;
  const listOf = (cfg, list) => (list === 'supps' ? cfg.supplements : cfg.tasks) || [];

  // ---- Drawing the page

  let deferred = false;
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName); };

  function render() {
    deferred = false;
    $('#title').textContent = pretty(Core.today());
    renderStatus();
    if (!Store.ready()) { main.innerHTML = setupView(); return; }
    const cfg = Store.config(), data = Store.data(), now = Core.today();
    if (!(cfg.tasks || []).length && !(cfg.supplements || []).length) {
      main.innerHTML = `<p class="muted center">${Store.status().state === 'error' ? esc(Store.status().error) : 'Loading…'}</p>`;
      return;
    }
    const active = list => (list || []).filter(t => Core.statusOn(t, now) === 'active');
    const labels = active(cfg.tasks).map(t => [t.name, Core.hint(t, data, now)])
      .concat(active(cfg.supplements).map(s => [s.name, s.dose || '']));
    const L = shown = layout(labels), dates = Core.weeks(now, L.weeks), scroll = scrollState();
    const tasks = Core.rows(cfg, data, dates, now).filter(r => r.cells.some(c => c.state !== 'none' && c.state !== 'off'));
    const supps = Core.suppRows(cfg, data, dates, now);
    main.innerHTML = (tasks.length ? ledger('tasks', tasks, dates, L, data) : '') + (supps.length ? ledger('supps', supps, dates, L, data) : '') +
      todayCard(data, now);
    restoreScroll(scroll);
    fade();
    main.querySelectorAll('.dtext').forEach(grow);
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

  // The name column is as wide as the longest name (with its hint), so short names (an emoji) leave
  // room for the boxes. Wide screens show as many weeks as fit, a phone shows one and swipes back.
  const GAP = 4, WEEK_GAP = 10;
  const ruler = document.createElement('canvas').getContext('2d');
  function textWidth(text, px) {
    ruler.font = `${px}px ${getComputedStyle(document.body).fontFamily}`;
    return ruler.measureText(text).width;
  }
  function layout(labels) {
    const narrow = innerWidth < 500;
    const inner = Math.min(main.clientWidth || innerWidth, 1200) - (narrow ? 16 + 20 : 24 + 28);   // main and card padding
    let label = textWidth('supplements', 12);
    for (const [name, hint] of labels) label = Math.max(label, textWidth(name, narrow ? 13.5 : 14) + (hint ? 6 + textWidth(hint, 11) : 0));
    label = Math.min(Math.ceil(label) + (prefs.colors ? 9 : 0) + 14, narrow ? 150 : 240);
    const avail = inner - label - WEEK_GAP;
    let cell = 24;
    const fit = Math.floor((avail + WEEK_GAP) / (7 * cell + 6 * GAP + WEEK_GAP));
    if (fit < 2) {
      cell = Math.max(20, Math.min(34, Math.floor((avail - 6 * GAP) / 7)));
      label = Math.max(label, inner - WEEK_GAP - 7 * cell - 6 * GAP);   // what's left over goes to the names: no sliver of last week
    }
    // how many of the oldest days in view fade out: 4 on a phone, a week when two fit, two weeks when more do
    const fadeDays = fit < 2 ? 4 : fit < 3 ? 7 : 14;
    return { label, cell, weeks: fit >= 2 ? Math.min(fit, 8) : 6, fadeDays };
  }

  // Older days fade out toward the left edge of what's in view, the oldest faintest; it follows a
  // swipe back. Today and days to come never fade.
  let shown = null, fading = false;
  function fade() {
    fading = false;
    if (!shown) return;
    const now = Core.today(), L = shown;
    const span = L.fadeDays * (L.cell + GAP) + (L.fadeDays > 7 ? WEEK_GAP : 0);
    main.querySelectorAll('.ledger').forEach(card => {
      const x0 = card.querySelector('.scroller').getBoundingClientRect().left + L.label + WEEK_GAP;
      card.querySelectorAll('.sq[data-date], .dh').forEach(el => {
        const t = (el.getBoundingClientRect().left - x0) / span;
        el.style.setProperty('--fade', (el.dataset.date || el.dataset.day) >= now || t >= 1 ? 1 : Math.max(0.2, 0.2 + 0.8 * t).toFixed(2));
      });
    });
  }
  main.addEventListener('scroll', () => { if (!fading) { fading = true; requestAnimationFrame(fade); } }, true);

  // Keep where each ledger was scrolled to; a ledger at its right end stays there (on this week).
  function scrollState() {
    const s = {};
    main.querySelectorAll('.ledger').forEach(c => {
      const sc = c.querySelector('.scroller');
      s[c.dataset.list] = { left: sc.scrollLeft, end: sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 4 };
    });
    return s;
  }
  function restoreScroll(s) {
    main.querySelectorAll('.ledger').forEach(c => {
      const sc = c.querySelector('.scroller'), k = s[c.dataset.list];
      sc.scrollLeft = !k || k.end ? sc.scrollWidth : k.left;
    });
  }

  function ledger(list, rows, dates, L, data) {
    const now = Core.today(), weeks = [];
    for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
    const head = `<div class="lrow head"><div class="lab">${list === 'supps' ? '<span class="title">supplements</span>' : ''}</div>` +
      weeks.map(w => `<div class="wk">${w.map((d, i) => {
        const noted = !!Core.dayText(data, d);
        return `<button class="dh${d === now ? ' today' : ''}${noted ? ' noted' : ''}" data-day="${d}" title="${pretty(d)}"><span>${'MTWTFSS'[i]}</span>${+d.slice(8)}</button>`;
      }).join('')}</div>`).join('') + '</div>';
    const body = rows.map(r => {
      const c = colorOf(r);
      return `<div class="lrow"><div class="lab"><button class="name" data-info="${r.id}" data-list="${list}">` +
        (prefs.colors && r.color ? `<i style="background:${c}"></i>` : '') +
        `<span class="n">${esc(r.name)}</span>${r.hint ? `<span class="hint">${esc(r.hint)}</span>` : ''}</button></div>` +
        weeks.map((w, wi) => `<div class="wk">${w.map((d, di) => box(r, r.cells[wi * 7 + di], list, c)).join('')}</div>`).join('') +
        '</div>';
    }).join('');
    return `<section class="card ledger" data-list="${list}" ` +
      `style="--cell:${L.cell}px;--label:${L.label}px;--gap:${GAP}px;--wgap:${WEEK_GAP}px">` +
      `<div class="scroller">${head}${body}</div><button class="addb" data-add="${list}" aria-label="Add">+</button></section>`;
  }

  function box(r, c, list, color) {
    if (c.state === 'none' || c.state === 'off') return '<span class="sq"></span>';
    return `<button class="sq s-${c.state}${c.note ? ' noted' : ''}" style="--c:${color}" data-id="${r.id}" data-list="${list}" ` +
      `data-date="${c.date}"></button>`;
  }

  // ---- Today: the day as a line from midnight to midnight, and the day's note

  const hm = min => `${Math.floor(min / 60)}:${Core.pad(Math.round(min) % 60)}`;
  const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const spansOf = at => String(at || '').split(' ').filter(Boolean).map(x => x.split('-').map(toMin));

  // Sleep is kept on the day you woke up: { at: [["2026-10-17 23:08", "2026-10-18 02:07"], ...], min, ... }.
  // A day's line takes that morning's (and naps), and the evening's from the next day's record.
  function sleepOn(data, date) {
    const out = { spans: [], woke: null, slept: null };
    const clip = (a, b) => {
      const x = Core.diffDays(date, a.slice(0, 10)) * 1440 + toMin(a.slice(11)), y = Core.diffDays(date, b.slice(0, 10)) * 1440 + toMin(b.slice(11));
      return y <= 0 || x >= 1440 ? null : [Math.max(0, x), Math.min(1440, y), x, y];
    };
    for (const d of [date, Core.addDays(date, 1)]) {
      for (const [a, b] of ((Core.dayOf(data, d) || {}).sleep || {}).at || []) {
        const c = clip(a, b);
        if (!c) continue;
        out.spans.push(c);
        if (d === date && c[3] < 15 * 60) out.woke = Math.max(out.woke ?? 0, c[3]);
        if (d !== date && c[2] >= 15 * 60 && (out.slept == null || c[2] < out.slept)) out.slept = c[2];
      }
    }
    return out;
  }

  function todayCard(data, date) {
    const day = Core.dayOf(data, date) || {}, pc = day.pc || {}, sl = sleepOn(data, date), sleep = day.sleep;
    const pct = m => (m / 1440 * 100).toFixed(2) + '%';
    const bar = (a, b, cls, color) => `<i class="${cls}" style="left:${pct(a)};width:max(2px,${pct(b - a)})${color ? ';background:' + color : ''}"></i>`;
    const woke = sl.woke ?? 7 * 60, slept = sl.slept ?? 23 * 60;
    const nowMin = date === Core.today() ? new Date().getHours() * 60 + new Date().getMinutes() : null;
    let line = `<i class="awake" style="left:${pct(woke)};width:${pct(Math.max(0, slept - woke))}"></i>`;
    for (const [a, b] of sl.spans) line += bar(a, b, 'sl');
    for (const [a, b] of spansOf(pc.screen && pc.screen.at)) line += bar(a, b, 'scr');
    for (const w of pc.work || []) for (const [a, b] of spansOf(w.at)) line += bar(a, b, 'wk', w.color);
    const mark = (m, real) => `<span class="mk${real ? ' real' : ''}" style="left:${pct(m)}"><b>${hm(m % 1440)}</b></span>`;
    if (nowMin != null) line += `<i class="now" style="left:${pct(nowMin)}"></i>`;
    const sums = [
      sleep && sleep.min ? `<span>slept ${hm(sleep.min)}</span>` : '',
      ...(pc.work || []).map(w => `<span><i class="cdot" style="background:${esc(w.color)}"></i>${esc(w.client)} ${hm(w.min)}</span>`),
      pc.screen ? `<span class="muted">screen ${hm(pc.screen.min)}</span>` : '',
    ].join('');
    return `<section class="card today"><div class="th"><span class="title">today</span><span class="sums">${sums}</span></div>` +
      `<div class="dline">${line}</div>` +
      `<div class="marks">${mark(woke, sl.woke != null)}${mark(Math.min(slept, 1439), sl.slept != null)}</div>` +
      `<div class="hours"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>` +
      `<textarea class="dtext" rows="1" data-date="${date}" aria-label="Today's note">${esc(Core.dayText(data, date))}</textarea></section>`;
  }

  // Saved when it loses focus. The page redraws a moment later, so a click that took the focus (a box)
  // still lands.
  let quiet = false;
  function saveDayText(ta) {
    const text = ta.value.trim(), date = ta.dataset.date;
    if (text === Core.dayText(Store.data(), date)) return;
    quiet = true;
    Store.change({ type: 'dayText', date, text });
    quiet = false;
    setTimeout(() => { if (deferred && !typing() && pop.hidden) render(); }, 300);
  }
  main.addEventListener('input', ev => { if (ev.target.matches('.dtext')) grow(ev.target); });
  main.addEventListener('focusout', ev => { if (ev.target.matches('.dtext')) saveDayText(ev.target); });
  main.addEventListener('keydown', ev => {
    if (ev.target.matches('.dtext') && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.target.blur(); }
  });

  // ---- Taps

  function tap(el) {
    const { id, list, date } = el.dataset, cfg = Store.config(), data = Store.data(), now = Core.today();
    if (date > now) return;
    const s = list === 'supps' ? Core.find(cfg.supplements, id) : null, t = s ? null : Core.find(cfg.tasks, id);
    if (t && t.kind === 'gym') return openGym(date);
    const on = s ? !(Core.suppOf(s, data, date) || {}).taken : !Core.isDone(t, data, date);
    const write = () => Store.change(s ? { type: 'supp', date, id, on, t: date === now ? Core.hhmm() : '', dose: s.dose || '' }
      : { type: 'task', date, id, done: on });
    if (!on && date < now) return untickPop(el, s || t, date, write);
    write();
  }

  // Unticking an earlier day asks first: Enter (or Untick) unticks, Esc or a click elsewhere keeps it.
  function untickPop(el, item, date, untick) {
    openPop(el, `<div class="ph"><i style="background:${colorOf(item)}"></i>${esc(item.name)} · ${pretty(date)}</div>` +
      '<div class="row end"><button class="btn small" data-pop="keep">Keep</button>' +
      '<button class="btn small danger" data-pop="untick">Untick</button></div>', {
      keep: () => closePop(false),
      untick: () => { closePop(false); untick(); },
    });
    pop.querySelector('[data-pop="untick"]').focus();
  }

  // ---- The little popover: a box's note, a day's notes, a name

  let popActs = null, swallowClick = false;

  function openPop(anchor, html, acts) {
    popActs = acts || {};
    pop.innerHTML = html;
    pop.hidden = false;
    pop.classList.remove('show');
    if (innerWidth < 600) {
      pop.style.cssText = `left:12px;right:12px;top:${$('header').getBoundingClientRect().bottom + 8}px`;
    } else {
      const r = anchor.getBoundingClientRect(), w = 320;
      let top = r.bottom + 8;
      if (top + pop.offsetHeight > innerHeight - 12) top = Math.max(12, r.top - 8 - pop.offsetHeight);
      pop.style.cssText = `width:${w}px;left:${Math.max(12, Math.min(r.left - 10, innerWidth - w - 12))}px;top:${top}px`;
    }
    requestAnimationFrame(() => pop.classList.add('show'));
    const ta = pop.querySelector('textarea, input');
    if (ta) { if (ta.tagName === 'TEXTAREA') grow(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  function closePop(save) {
    if (pop.hidden) return;
    const acts = popActs;
    popActs = null;
    if (save && acts && acts.save) acts.save();
    pop.hidden = true;
    pop.classList.remove('show');
    pop.innerHTML = '';
    if (deferred) render();
  }

  const grow = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };

  function notePop(el) {
    const { id, list, date } = el.dataset, data = Store.data();
    const item = Core.find(listOf(Store.config(), list), id);
    const e = list === 'supps' ? Core.suppOf(item, data, date) : Core.entryOf(item, data, date);
    const cur = (e && e.note) || '';
    const taken = list === 'supps' && e && e.taken ? ` · ${[e.t, e.dose].filter(Boolean).join(' ')}` : '';
    openPop(el, `<div class="ph"><i style="background:${colorOf(item)}"></i>${esc(item.name)} · ${pretty(date)}${esc(taken)}</div><textarea rows="1">${esc(cur)}</textarea>`, {
      save: () => {
        const text = pop.querySelector('textarea').value.trim();
        if (text !== cur) Store.change(list === 'supps' ? { type: 'suppNote', date, id, text } : { type: 'note', date, id, text });
      },
    });
  }

  function dayPop(el) {
    const date = el.dataset.day, cur = Core.dayText(Store.data(), date);
    openPop(el, `<div class="ph">${pretty(date)}</div><textarea rows="2">${esc(cur)}</textarea>`, {
      save: () => {
        const text = pop.querySelector('textarea').value.trim();
        if (text !== cur) Store.change({ type: 'dayText', date, text });
      },
    });
  }

  // A new task (daily, optional or on one weekday) or supplement (with its dose). Enter adds it.
  function addPop(el) {
    const list = el.dataset.add, wd = Core.WEEKDAYS[Core.weekday(Core.today())];
    const chips = list === 'supps' ? '<input class="dose" aria-label="Dose" autocomplete="off">' :
      '<div class="chips">' + [['daily', 'daily'], ['optional', 'optional'], ['weekly', 'weekly']]
        .map(([k, t], i) => `<button class="chip${i ? '' : ' on'}" data-pop="kind" data-kind="${k}">${t}</button>`).join('') + '</div>' +
      '<div class="chips days" hidden>' + ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        .map(d => `<button class="chip${d === wd ? ' on' : ''}" data-pop="day" data-day="${d}">${d}</button>`).join('') + '</div>';
    openPop(el, `<div class="ph">${list === 'supps' ? 'new supplement' : 'new task'}</div>` +
      `<input class="nm" aria-label="Name" autocomplete="off" autocapitalize="off">${chips}`, {
      save: () => {
        const name = pop.querySelector('.nm').value.trim();
        if (!name) return;
        const cfg = Store.config();
        if (list === 'supps') return Store.change(Core.newItem(cfg, 'supplements', name, { dose: pop.querySelector('.dose').value.trim() }));
        const kind = pop.querySelector('.chips .on').dataset.kind, day = pop.querySelector('.days .on').dataset.day;
        Store.change(Core.newItem(cfg, 'tasks', name, kind === 'weekly' ? { kind: 'weekly', day } : kind === 'optional' ? { kind: 'daily', must: false } : { kind: 'daily' }));
      },
      kind: b => {
        pop.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b));
        pop.querySelector('.days').hidden = b.dataset.kind !== 'weekly';
        pop.querySelector('.nm').focus();
      },
      day: b => { pop.querySelectorAll('[data-day]').forEach(x => x.classList.toggle('on', x === b)); pop.querySelector('.nm').focus(); },
    });
  }

  // A name: edit it in place (Enter saves; emoji welcome), or archive the row.
  function namePop(el) {
    const { info: id, list } = el.dataset, item = Core.find(listOf(Store.config(), list), id);
    const which = list === 'supps' ? 'supplements' : 'tasks';
    openPop(el, `<input class="nm" value="${esc(item.name)}" aria-label="Name" autocomplete="off" autocapitalize="off">` +
      '<div class="row end"><button class="btn small" data-pop="archive">Archive</button></div>', {
      save: () => {
        const name = pop.querySelector('input').value.trim();
        if (name && name !== item.name) Store.change({ type: 'rename', list: which, id, name });
      },
      archive: () => {
        Store.change({ type: 'status', list: which, id, date: Core.today(), status: 'archived' });
        closePop(false);
      },
    });
  }

  pop.addEventListener('click', ev => {
    const b = ev.target.closest('[data-pop]');
    if (b && popActs && popActs[b.dataset.pop]) popActs[b.dataset.pop](b);
  });
  pop.addEventListener('input', ev => { if (ev.target.tagName === 'TEXTAREA') grow(ev.target); });
  pop.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); closePop(false); }
    else if (ev.key === 'Enter' && !ev.shiftKey && /^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) { ev.preventDefault(); closePop(true); }
  });
  // A click outside saves and closes it (and doesn't also tick a box)
  document.addEventListener('pointerdown', ev => {
    if (!pop.hidden && !pop.contains(ev.target)) { closePop(true); swallowClick = true; }
  }, true);

  // ---- Clicks, right-clicks, long presses on the page

  let press = null;
  main.addEventListener('pointerdown', ev => {
    const el = ev.target.closest('.sq[data-id], .dh, .name');
    if (!el || ev.pointerType === 'mouse') return;
    press = { el, x: ev.clientX, y: ev.clientY, long: false };
    press.timer = setTimeout(() => { press.long = true; longPress(el); }, 450);
  });
  const cancelPress = () => { if (press) clearTimeout(press.timer); };
  main.addEventListener('pointermove', ev => { if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancelPress(); });
  main.addEventListener('pointerup', cancelPress);
  main.addEventListener('pointercancel', cancelPress);

  function longPress(el) {
    if (el.matches('.sq')) notePop(el); else if (el.matches('.dh')) dayPop(el); else namePop(el);
  }

  main.addEventListener('contextmenu', ev => {
    const el = ev.target.closest('.sq[data-id], .dh, .name');
    if (!el) return;
    ev.preventDefault();
    if (!press || !press.long) longPress(el);
  });

  main.addEventListener('click', ev => {
    if (swallowClick) { swallowClick = false; return; }
    const el = ev.target.closest('button');
    if (!el) return;
    if (press && press.long && press.el === el) { press = null; return; }
    press = null;
    const ds = el.dataset;
    if (ds.id && ds.date) return ev.ctrlKey || ev.altKey || ev.metaKey ? notePop(el) : tap(el);
    if (ds.day) return dayPop(el);
    if (ds.info) return namePop(el);
    if (ds.add) return addPop(el);
    if (ds.act === 'settings') return openSettings();
  });

  // ---- Panels (gym, settings): a sheet over the page

  let sheetRender = null;
  function openSheet(fn) {
    closePop(true);
    sheetRender = fn;
    sheetEl.hidden = false;
    renderSheet();
    requestAnimationFrame(() => sheetEl.classList.add('show'));
  }
  function renderSheet() { if (sheetRender) sheetEl.innerHTML = `<div class="panel">${sheetRender()}</div>`; }
  function closeSheet() {
    sheetEl.classList.remove('show');
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
    sheetRender = null;
    render();
  }
  const sheetHead = title => `<div class="sh"><span>${title}</span><button class="x" data-close aria-label="Close">×</button></div>`;

  // ---- Gym: the day's exercises; pick one (recent first), last time's sets prefilled, add sets

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

  const gym = { date: null, ex: null, picking: false, search: '', next: null, armed: -1 };
  function openGym(date) {
    Object.assign(gym, { date, ex: null, picking: false, search: '', next: null, armed: -1 });
    openSheet(gymView);
  }

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
    if (gym.ex) return exerciseView();
    if (gym.picking) return pickerView();
    const g = gymDay(gym.date), ex = (g && g.ex) || [];
    return sheetHead(`gym · ${pretty(gym.date)}`) +
      ex.map(e => `<button class="exrow" data-ex="${esc(e.name)}">${esc(e.name)}<small>${esc(fmtSets(e.sets))}${e.note ? ' · ' + esc(e.note) : ''}</small></button>`).join('') +
      '<button class="btn wide primary big" data-g="pick">+ exercise</button>' +
      `<label>note<input id="gnote" value="${esc(g && g.note)}"></label>` +
      (!g ? '<button class="btn wide" data-g="went">Went, no details</button>' : !ex.length ? '<button class="btn wide" data-g="notgym">Not a gym day</button>' : '');
  }

  function pickerView() {
    return `<div class="row"><button class="back" data-g="back" aria-label="Back">‹</button>` +
      `<input id="search" aria-label="Find or add an exercise" autocomplete="off" autocapitalize="off" value="${esc(gym.search)}"></div>` +
      `<div id="picklist">${pickList()}</div>`;
  }

  function pickList() {
    const hist = gymHistory(), q = gym.search.trim().toLowerCase();
    const list = Object.keys(hist).map(name => {
      const before = hist[name].filter(x => x.date < gym.date).pop();
      return { name, last: before || hist[name][hist[name].length - 1], today: hist[name].some(x => x.date === gym.date) };
    }).sort((a, b) => (a.last.date < b.last.date ? 1 : a.last.date > b.last.date ? -1 : 0));
    const shown = q ? list.filter(e => e.name.includes(q)) : list;
    const add = q && !list.some(e => e.name === q) ? `<button class="pick new" data-pick="${esc(q)}">+ add “${esc(q)}”</button>` : '';
    return add + shown.map(e => `<button class="pick" data-pick="${esc(e.name)}">${esc(e.name)}${e.today ? '<span class="badge">today</span>' : ''}` +
      `<small>${rel(e.last.date)} · ${esc(fmtSets(e.last.sets))}</small></button>`).join('');
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
    const e = exOf(gym.date, gym.ex), sets = (e && e.sets) || [], prev = previous(gym.ex, gym.date);
    const next = gym.next || prefill(sets, prev);
    return `<div class="row"><button class="back" data-g="back" aria-label="Back">‹</button><h3 class="grow">${esc(gym.ex)}</h3>` +
      `<button class="x" data-close aria-label="Close">×</button></div>` +
      `<p class="muted small">${prev ? `last time, ${rel(prev.date)}: ${esc(fmtSets(prev.sets))}${prev.note ? ' · ' + esc(prev.note) : ''}` : 'first time'}</p>` +
      `<ol class="sets">${sets.map((s, i) => `<li><span><span class="n">${i + 1}</span>${kgText(s[0])} × ${s[1] ?? '?'}</span>` +
        `<button class="del${gym.armed === i ? ' armed' : ''}" data-del="${i}">${gym.armed === i ? 'delete?' : '✕'}</button></li>`).join('')}</ol>` +
      `<div class="steppers">
        <div class="stepper"><span class="lbl">kg (BW = bodyweight)</span><div class="ctl"><button data-step="kg,-1">−</button>` +
        `<input id="kg" inputmode="decimal" value="${kgText(next[0])}"><button data-step="kg,1">+</button></div></div>
        <div class="stepper"><span class="lbl">reps</span><div class="ctl"><button data-step="reps,-1">−</button>` +
        `<input id="reps" inputmode="numeric" value="${next[1] ?? ''}"><button data-step="reps,1">+</button></div></div>
      </div>` +
      `<button class="btn wide primary big" data-g="addset">Add set ${sets.length + 1}</button>` +
      (sets.length ? `<label>note<input id="exnote" value="${esc(e.note)}"></label>` : '');
  }

  function step(field, dir) {
    const el = $('#' + field);
    if (field === 'kg') el.value = kgText(Math.round(((parseKg(el.value) ?? 0) + dir * 2.5) * 100) / 100);
    else el.value = Math.max(0, (parseInt(el.value, 10) || 0) + dir);
    gym.next = [parseKg($('#kg').value), parseInt($('#reps').value, 10)];
  }

  function addSet() {
    const e = exOf(gym.date, gym.ex), reps = parseInt($('#reps').value, 10);
    const sets = ((e && e.sets) || []).concat([[parseKg($('#kg').value), isNaN(reps) ? null : reps]]);
    Store.change({ type: 'gymEx', date: gym.date, name: gym.ex, sets });
    gym.next = null;
    gym.armed = -1;
    renderSheet();
  }

  function deleteSet(i) {
    if (gym.armed !== i) {
      gym.armed = i;
      renderSheet();
      setTimeout(() => { if (gym.armed === i) { gym.armed = -1; if (sheetRender === gymView) renderSheet(); } }, 3000);
      return;
    }
    const e = exOf(gym.date, gym.ex);
    Store.change({ type: 'gymEx', date: gym.date, name: gym.ex, sets: e.sets.filter((_, j) => j !== i), note: e.note });
    gym.armed = -1;
    renderSheet();
  }

  function gymClick(el) {
    const ds = el.dataset;
    if (ds.ex) { gym.ex = ds.ex; gym.next = null; gym.armed = -1; return renderSheet(); }
    if (ds.pick) { gym.ex = ds.pick.trim().toLowerCase(); gym.picking = false; gym.search = ''; gym.next = null; gym.armed = -1; return renderSheet(); }
    if (ds.step) { const [f, dir] = ds.step.split(','); return step(f, +dir); }
    if (ds.del) return deleteSet(+ds.del);
    switch (ds.g) {
      case 'pick': gym.picking = true; gym.search = ''; renderSheet(); return $('#search') && $('#search').focus();
      case 'back': if (gym.ex) gym.ex = null; else gym.picking = false; gym.next = null; return renderSheet();
      case 'addset': return addSet();
      case 'went': Store.change({ type: 'gymDay', date: gym.date, on: true }); return renderSheet();
      case 'notgym': Store.change({ type: 'gymDay', date: gym.date, on: false }); return renderSheet();
    }
  }

  // ---- Settings: token, this device, colors, archived things

  function openSettings() { openSheet(settingsView); }

  function settingsView() {
    const s = Store.settings, st = Store.status(), cfg = Store.config(), now = Core.today();
    const archived = [...(cfg.tasks || []).map(t => ['tasks', t]), ...(cfg.supplements || []).map(t => ['supplements', t])]
      .filter(([, t]) => { const x = Core.statusOn(t, now); return x && x !== 'active'; });
    const last = st.last ? `Last synced ${Core.hhmm(new Date(st.last))}.` : '';
    return sheetHead('Settings') +
      (Store.LOCAL ? '<p class="muted small">Local test server: no token needed, data stays on this PC.</p>' :
        `<label>GitHub token<input id="token" type="password" autocomplete="off" value="${esc(s.token)}"></label>
        <p class="muted small">Fine-grained, for the daily-widget repo only, Contents: read and write.
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create one on GitHub</a></p>`) +
      `<label>This device<input id="device" value="${esc(s.device)}"></label>` +
      `<label class="check"><input type="checkbox" id="colors"${prefs.colors ? ' checked' : ''}> A color per task (off: all green)</label>` +
      (archived.length ? '<h4>Archived</h4>' + archived.map(([list, t]) =>
        `<div class="arow"><span>${esc(t.name)}</span><button class="btn small" data-s="restore" data-list="${list}" data-id="${t.id}">Restore</button></div>`).join('') : '') +
      `<p class="muted small">${st.error ? esc(st.error) + '. ' : ''}${last} ${Store.waiting() ? Store.waiting() + ' changes waiting.' : ''}</p>` +
      '<div class="row end"><button class="btn" data-s="sync">Sync now</button><button class="btn primary" data-s="save">Save</button></div>';
  }

  function settingsClick(el) {
    switch (el.dataset.s) {
      case 'sync': Store.sync(); return closeSheet();
      case 'restore':
        Store.change({ type: 'status', list: el.dataset.list, id: el.dataset.id, date: Core.today(), status: 'active' });
        return renderSheet();
      case 'save': {
        const tok = $('#token');
        Store.setSettings({ device: $('#device').value.trim() || Store.settings.device, ...(tok ? { token: tok.value.trim() } : {}) });
        return closeSheet();
      }
    }
  }

  sheetEl.addEventListener('click', ev => {
    if (ev.target === sheetEl) return closeSheet();
    const el = ev.target.closest('button');
    if (!el) return;
    if ('close' in el.dataset) return closeSheet();
    if (sheetRender === gymView) gymClick(el); else settingsClick(el);
  });
  sheetEl.addEventListener('input', ev => {
    const id = ev.target.id;
    if (id === 'search') { gym.search = ev.target.value; $('#picklist').innerHTML = pickList(); }
    if (id === 'kg' || id === 'reps') gym.next = [parseKg($('#kg').value), parseInt($('#reps').value, 10)];
  });
  sheetEl.addEventListener('change', ev => {
    const id = ev.target.id;
    if (id === 'gnote') Store.change({ type: 'gymNote', date: gym.date, text: ev.target.value.trim() });
    if (id === 'exnote') { const e = exOf(gym.date, gym.ex); if (e) Store.change({ type: 'gymEx', date: gym.date, name: gym.ex, sets: e.sets, note: ev.target.value.trim() }); }
    if (id === 'colors') { prefs.colors = ev.target.checked; savePrefs(); render(); }
  });
  sheetEl.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') return closeSheet();
    if (ev.key !== 'Enter') return;
    const id = ev.target.id;
    if (id === 'search' && gym.search.trim()) { const first = $('#picklist [data-pick]'); if (first) first.click(); }
    else if (id === 'kg' || id === 'reps') addSet();
    else if (id === 'gnote' || id === 'exnote') ev.target.blur();
  });

  // ---- Keeping it current

  $('#gear').addEventListener('click', openSettings);
  statusEl.addEventListener('click', () => (Store.ready() && Store.status().state !== 'error' ? Store.sync() : openSettings()));

  Store.onChange(what => {
    if (what === 'status') return renderStatus();
    if (!pop.hidden || typing() || quiet) { deferred = true; return renderStatus(); }
    render();
    if (!sheetEl.hidden) renderSheet();
  });
  document.addEventListener('focusout', () => setTimeout(() => { if (deferred && !typing() && pop.hidden) render(); }, 0));

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!typing() && pop.hidden) render(); }, 150);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !typing() && pop.hidden) render(); });

  render();
  Store.sync();
  if ('serviceWorker' in navigator && !Store.LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
