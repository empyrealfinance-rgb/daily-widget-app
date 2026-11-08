// One page: to-dos, tasks and supplements as ledgers, weeks Monday to Sunday, the weeks to come to the
// right (swipe on to plan; they all move together; the date at the top brings them back). A box with a
// note gets a small dot in its corner; the note itself stays out of sight.
//   click a box                                   done / not done (gym: the gym panel; supplement: taken now);
//                                                 unticking an earlier day asks first
//   right-click, Ctrl/Alt+click, long-press a box its note (Enter saves, Esc closes); a day of steps or sleep too
//   click a date                                  that day's journal; a day to come: a new to-do for it
//   click a name                                  rename it (Enter saves), move it up or down, Archive
//   the empty box under the to-dos                type a new to-do in place (Enter adds it, Esc drops it)
//   +                                             a new task or supplement
// To-dos: each on the day it's planned for (today, or a day picked), so an open one slides left as days
// pass; a done one is ticked and crossed out, and makes room 15 minutes later. Under the lists, today: the day as
// a line (sleep, screen time, client work from the laptop's time tracker) and the journal: notes with the
// time they're about (right-click the line for a moment of the day). The chart button: everything for a
// week, month or year.
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
    // a repeating to-do's day: add it (quiet: no second draw from inside this one)
    const due = Core.repeatsDue(Store.todo(), now);
    if (due.length) { const q = quiet; quiet = true; due.forEach(op => Store.change(op)); quiet = q; }
    const L = shown = layout(labels), dates = calendar(now, L.weeks);
    const scroll = scrollState();
    const tasks = Core.rows(cfg, data, dates, now).filter(r => r.cells.some(c => c.state !== 'none' && c.state !== 'off'));
    const supps = Core.suppRows(cfg, data, dates, now);
    const health = healthRows(data, dates, now);
    const cards = {
      todo: todoCard(now), screen: screenCard(data, now), today: todayCard(data, now), gym: gymCard(data, now),
      health: health.length ? ledger('health', health, dates, L) : '', journal: journalCard(data, now),
      tasks: ledger('tasks', tasks, dates, L), supps: supps.length ? ledger('supps', supps, dates, L) : '',
    };
    const nArch = nArchived(cfg);
    // at the bottom: the archive (the "gym progress" button there went 2026-11-08: the gym card has "progress")
    main.innerHTML = cardOrder().filter(k => !(cfg.cardsHidden || []).includes(k)).map(k => cards[k]).join('') + '<div class="pagebtns">' +
      (nArch ? `<button class="arcbtn" data-act="archive">archive · ${nArch}</button>` : '') + '</div>';
    restoreScroll(scroll);
    homeKeeper.disconnect();
    main.querySelectorAll('.ledger .scroller').forEach(sc => homeKeeper.observe(sc));
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
      // a phone: seven days in view, whichever they are (a week's gap among them or not): what's left over goes to
      // the names, so no sliver of another day shows
      cell = Math.max(20, Math.min(34, Math.floor((avail - 6 * GAP - WEEK_GAP) / 7)));
      label = Math.max(label, inner - 2 * WEEK_GAP - 7 * cell - 6 * GAP);
    }
    // how many of the oldest days in view fade out: 4 on a phone, a week when two fit, two weeks when more do
    const fadeDays = fit < 2 ? 4 : fit < 3 ? 7 : 14;
    return { label, cell, weeks: fit >= 2 ? Math.min(fit, 8) : 6, fadeDays };
  }

  // The days on the page: the weeks that fit (a phone: six, to swipe back to), then two months to come, to
  // swipe on to.
  function calendar(now, weeks) {
    return Core.span(Core.addDays(Core.monday(now), -7 * (weeks - 1)), Core.addDays(Core.monday(Core.addDays(now, 7 * 8)), 6));
  }

  // Older days fade out toward the left edge of what's in view, the oldest faintest; it follows a
  // swipe back. Today and days to come never fade. Positions are all read first, then set, so the page is laid
  // out once per frame.
  let shown = null, fading = false;
  function fade() {
    fading = false;
    if (!shown) return;
    const now = Core.today(), L = shown, set = [];
    const span = L.fadeDays * (L.cell + GAP) + (L.fadeDays > 7 ? WEEK_GAP : 0);
    main.querySelectorAll('.ledger').forEach(card => {
      const x0 = card.querySelector('.scroller').getBoundingClientRect().left + L.label + WEEK_GAP;
      card.querySelectorAll('.sq[data-date], .dh').forEach(el => {
        if ((el.dataset.date || el.dataset.day) >= now) return;
        const t = (el.getBoundingClientRect().left - x0) / span;
        set.push([el, t >= 1 ? '1' : Math.max(0.2, 0.2 + 0.8 * t).toFixed(2)]);
      });
    });
    for (const [el, v] of set) if (el.style.getPropertyValue('--fade') !== v) el.style.setProperty('--fade', v);
  }

  // The ledgers move together: the one being swiped (or wheeled) leads, the others follow it.
  let driver = null, atHome = true;
  const lead = ev => { driver = ev.target.closest ? ev.target.closest('.scroller') : null; };
  main.addEventListener('touchstart', lead, { passive: true, capture: true });
  main.addEventListener('wheel', lead, { passive: true, capture: true });
  main.addEventListener('pointerdown', lead, true);
  main.addEventListener('scroll', ev => {
    const sc = ev.target;
    if (sc === driver) {
      main.querySelectorAll('.ledger .scroller').forEach(o => { if (o !== sc && Math.abs(o.scrollLeft - sc.scrollLeft) > 1) o.scrollLeft = sc.scrollLeft; });
      atHome = Math.abs(sc.scrollLeft - homeLeft(sc)) < 4;
    }
    if (!fading) { fading = true; requestAnimationFrame(fade); }
  }, true);

  // Where the ledgers open: tomorrow at the right edge, as on the widget (a phone: the five days before today,
  // today, tomorrow); swipe on for the days to come. A redraw keeps them where they were swiped to (or at that
  // spot, when they weren't); the date at the top brings them back.
  function homeLeft(sc) {
    const dh = sc.querySelector(`.dh[data-day="${Core.addDays(Core.today(), 1)}"]`);
    return dh ? Math.max(0, dh.offsetLeft + dh.offsetWidth + 1 - sc.clientWidth) : sc.scrollWidth;
  }
  // A launch can lay the page out at another width first, or hidden (the Home Screen app does): while the
  // ledgers are at home, they stay there whatever width they end up with.
  const homeKeeper = new ResizeObserver(() => {
    if (atHome) main.querySelectorAll('.ledger .scroller').forEach(sc => { sc.scrollLeft = homeLeft(sc); });
  });
  function scrollState() {
    const sc = main.querySelector('.ledger .scroller');
    return sc ? { left: sc.scrollLeft } : null;
  }
  function restoreScroll(s) {
    main.querySelectorAll('.ledger .scroller').forEach(sc => { sc.scrollLeft = !s || atHome ? homeLeft(sc) : s.left; });
  }
  $('#title').addEventListener('click', () => {
    driver = null;
    atHome = true;
    main.querySelectorAll('.ledger .scroller').forEach(sc => sc.scrollTo({ left: homeLeft(sc), behavior: 'smooth' }));
  });

  // One card: tasks, supplements or health. Weekday letters and dates over the columns (a month's name on
  // its 1st), the rows, and + to add.
  function ledger(list, rows, dates, L) {
    const now = Core.today(), weeks = [];
    for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
    const head = `<div class="lrow head"><div class="lab"><span class="title grip">${{ todo: 'to-do', tasks: 'tasks', supps: 'supplements', health: 'health' }[list]}</span></div>` +
      weeks.map(w => `<div class="wk">${w.map((d, i) => {
        const n = +d.slice(8), lbl = n === 1 ? MONTHS[+d.slice(5, 7) - 1] : n;
        return `<button class="dh${d === now ? ' today' : ''}${n === 1 ? ' m1' : ''}" data-day="${d}" title="${pretty(d)}"><span>${'MTWTFSS'[i]}</span>${lbl}</button>`;
      }).join('')}</div>`).join('') + '</div>';
    const body = list === 'health' ? rows.map(r =>
      `<div class="lrow${r.tall ? ' tall' : ''}"><div class="lab"><span class="name"><i style="background:${r.color}"></i><span class="n">${r.name}</span>` +
      `${r.hint ? `<span class="hint">${r.hint}</span>` : ''}</span></div>` +
      weeks.map(w => `<div class="wk">${w.map(d => (r.name === 'sleep' ? night(r, d, L) : stepsCell(r, d, L))).join('')}</div>`).join('') + '</div>').join('') : rows.map(r => {
      const c = colorOf(r);
      return `<div class="lrow"><div class="lab"><button class="name${r.quiet ? ' quiet' : ''}" data-info="${r.id}" data-list="${list}">` +
        (prefs.colors && r.color ? `<i style="background:${c}"></i>` : '') +
        `<span class="n">${esc(r.name)}</span>${r.hint ? `<span class="hint">${esc(r.hint)}</span>` : ''}</button></div>` +
        weeks.map((w, wi) => `<div class="wk">${w.map((d, di) => box(r, r.cells[wi * 7 + di], list, c)).join('')}</div>`).join('') +
        '</div>';
    }).join('');
    // today's column: a warm band behind it, fading out at its ends
    const ti = dates.indexOf(now), tx = L.label + WEEK_GAP + Math.floor(ti / 7) * (7 * L.cell + 6 * GAP + WEEK_GAP) + (ti % 7) * (L.cell + GAP);
    const band = ti < 0 ? '' : `<i class="tcol" style="left:${tx - 3}px;width:${L.cell + 6}px"></i>`;
    return `<section class="card ledger" data-list="${list}" data-card="${list}" ` +
      `style="--cell:${L.cell}px;--label:${L.label}px;--gap:${GAP}px;--wgap:${WEEK_GAP}px">` +
      `<div class="scroller">${band}${head}${body}</div>` +
      (list === 'health' ? '' : `<button class="addb" data-add="${list}" aria-label="Add">+</button>`) + '</section>';
  }

  // ---- Health: Apple Health's steps and the nights' sleep, a day each (docs/HEALTH.md); a row shows once it has
  // a day. Beside the name, the last 7 days' average.
  //   steps  a taller row: the day as a bar like Apple Health's, 12,000 = the row, the count on top of it; a faint
  //          mark at 7,000 (the goal), a bar that reaches it solid
  //   sleep  a taller row: the night as a vertical line, its length the time asleep (up to 12 hours), broken
  //          where he woke up; a faint mark at 8 hours; the hours under it
  // A day of either takes a note like a box (right-click, Ctrl/Alt+click, long-press; day.health.<row>.note).
  const STEPS = '#6cb4c4', SLEEP = '#8e8bd6', STEP_GOAL = 7000, STEP_TOP = 12000;
  function healthRows(data, dates, now) {
    const steps = {}, sleep = {}, nights = {}, notes = { steps: {}, sleep: {} };
    for (const d of dates) {
      const day = Core.dayOf(data, d);
      if (Core.stepsOf(day)) steps[d] = Core.stepsOf(day);
      if (day && day.sleep && day.sleep.min) { sleep[d] = day.sleep.min; nights[d] = day.sleep; }
      for (const k in (day && day.health) || {}) if (notes[k] && day.health[k].note) notes[k][d] = day.health[k].note;
    }
    const avg = (vals, fmt) => {
      const l = [];
      for (let i = 0; i < 7; i++) { const v = vals[Core.addDays(now, -i)]; if (v != null) l.push(v); }
      return l.length ? 'avg ' + fmt(Math.round(l.reduce((a, b) => a + b, 0) / l.length)) : '';
    };
    const out = [];
    if (Object.keys(steps).length) out.push({ name: 'steps', color: STEPS, vals: steps, fmt: kSteps, hint: avg(steps, kSteps), notes: notes.steps, tall: true });
    if (Object.keys(sleep).length) out.push({ name: 'sleep', color: SLEEP, vals: sleep, nights, fmt: hm, hint: avg(sleep, hm), notes: notes.sleep, tall: true });
    return out;
  }
  const kSteps = n => (n < 1000 ? String(Math.round(n)) : n < 9950 ? (n / 1000).toFixed(1) + 'k' : Math.round(n / 1000) + 'k');
  const nSteps = n => Math.round(n).toLocaleString('en-US');
  // A health cell: a button for its note on the days so far (a dot in the corner when it has one)
  function hcell(r, d, cls, style, title, inner) {
    if (d > Core.today()) return `<span class="sq ${cls}"></span>`;
    const note = r.notes[d];
    return `<button class="sq ${cls}${note ? ' noted' : ''}" data-hrow="${r.name}" data-date="${d}" style="${style}" ` +
      `title="${esc(title + (note ? ' · ' + note : ''))}">${inner}</button>`;
  }
  // A day's steps: a bar, 12,000 = the row (less the count on top), solid once it reaches the goal
  function stepsCell(r, d, L) {
    const v = r.vals[d], title = `${pretty(d)}: ${v != null ? nSteps(v) + ' steps' : 'no steps'}`;
    const room = Math.round(L.cell * 3) - 14, per = room / STEP_TOP, style = `--g:${Math.round(STEP_GOAL * per)}px;--c:${r.color}`;
    if (v == null) return hcell(r, d, 'st', style, title, '');
    const h = Math.max(3, Math.min(room, v * per)).toFixed(1);
    return hcell(r, d, `st${v >= STEP_GOAL ? ' goal' : ''}`, style, title, `<b>${nSteps(v)}</b><i style="height:${h}px"></i>`);
  }
  // A night: the time asleep as a vertical line, 12 hours = the row's height (less the hours under it). Broken where
  // he woke up: at the wake-ups' times from the screenshots' stage chart (wakes), else at the gaps between Apple
  // Health's In Bed stretches, else, for a night from the screenshots (woke = how many times), evenly.
  function night(r, d, L) {
    const s = r.nights[d], rowH = Math.round(L.cell * 3), room = rowH - 14, per = room / 720;
    const guide = `--g:${Math.round(14 + 480 * per)}px`;
    if (!s) return hcell(r, d, 'sl', guide, `${pretty(d)}: no sleep`, '');
    const spans = (s.at || []).map(([a, b]) => Core.diffDays(a.slice(0, 10), b.slice(0, 10)) * 1440 + toMin(b.slice(11)) - toMin(a.slice(11))).filter(m => m > 0);
    const exact = wakeParts(s), woke = exact ? exact.length - 1 : s.woke != null ? s.woke : Math.max(0, spans.length - 1);
    const parts = exact || (spans.length === woke + 1 ? spans : Array(woke + 1).fill(1));
    const sum = parts.reduce((a, b) => a + b, 0), len = Math.min(room, s.min * per);
    const segs = parts.map(p => `<i style="height:${Math.max(2, len * p / sum - (woke ? 2 : 0)).toFixed(1)}px"></i>`).join('');
    return hcell(r, d, 'sl', `${guide};--c:${r.color}`, `${pretty(d)}: slept ${hm(s.min)}, woke ${woke}×`,
      `<span class="ln">${segs}</span><b>${hm(s.min)}</b>`);
  }
  // The stretches asleep between the wake-ups (wakes: [["02:14", 6], …], when and how many minutes), from falling
  // asleep to getting up; null when there are none or they don't fit the night
  function wakeParts(s) {
    if (!s.wakes || !s.wakes.length || !s.at || !s.at.length) return null;
    const t0 = s.at[0][0], t1 = s.at[s.at.length - 1][1], a = toMin(t0.slice(11));
    const z = Core.diffDays(t0.slice(0, 10), t1.slice(0, 10)) * 1440 + toMin(t1.slice(11)), out = [];
    let cur = a;
    for (const [hhmm, m] of s.wakes) {
      let w = toMin(hhmm);
      if (w < a) w += 1440;
      out.push(w - cur);
      cur = w + (m || 0);
    }
    out.push(z - cur);
    return out.every(x => x > 0) ? out : null;
  }
  // A health day's note (steps or sleep), like a box's
  function healthNotePop(el) {
    const { hrow, date } = el.dataset, day = Core.dayOf(Store.data(), date) || {};
    const cur = (day.health && day.health[hrow] && day.health[hrow].note) || '';
    const what = hrow === 'steps' ? (day.steps ? nSteps(Core.stepsOf(day)) + ' steps' : '') : (day.sleep && day.sleep.min ? 'slept ' + hm(day.sleep.min) : '');
    openPop(el, `<div class="ph"><i style="background:${hrow === 'steps' ? STEPS : SLEEP}"></i>${hrow} · ${pretty(date)}${what ? ' · ' + what : ''}</div>` +
      `<textarea rows="1">${esc(cur)}</textarea>`, {
      save: () => {
        const text = pop.querySelector('textarea').value.trim();
        if (text !== cur) Store.change({ type: 'healthNote', date, id: hrow, text, at: Core.stamp() });
      },
    });
  }

  // ---- Moving the cards: hold a card's title for half a second, then drag it up or down. The order is kept on
  // this device (prefs.pageOrder); a card added later goes to the end. Since 2026-11-08 (his ask, "that's it for now,
  // the rest can be archived"): to-do, gym, screen time, journal; today and health in the archive (config cardsHidden).
  // A new key, so the order dragged before (prefs.pageCards) doesn't keep the old one.
  const CARDS = ['todo', 'gym', 'screen', 'journal', 'today', 'health'];
  const CARD_NAMES = { todo: 'to-do', gym: 'gym', screen: 'screen time', journal: 'journal', today: 'today', health: 'health' };
  function cardOrder() {
    const o = (prefs.pageOrder || []).filter(k => CARDS.includes(k));
    return [...o, ...CARDS.filter(k => !o.includes(k))];
  }
  let drag = null;
  main.addEventListener('pointerdown', ev => {
    const card = ev.target.closest('.grip') && ev.target.closest('.card[data-card]');
    if (!card || drag) return;
    const d = drag = { card, id: ev.pointerId, x: ev.clientX, y: ev.clientY, on: false };
    d.timer = setTimeout(() => {
      d.on = true;
      d.grab = d.y - card.getBoundingClientRect().top;
      card.classList.add('lifted');
      if (navigator.vibrate) navigator.vibrate(10);
    }, 450);
  });
  function endDrag(keep) {
    const d = drag;
    drag = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.on) return;
    d.card.classList.remove('lifted');
    d.card.style.transform = '';
    if (keep) {
      const shown = [...main.querySelectorAll('.card[data-card]')].map(c => c.dataset.card);
      prefs.pageOrder = [...shown, ...cardOrder().filter(k => !shown.includes(k))];
      savePrefs();
    }
    render();
  }
  addEventListener('pointermove', ev => {
    const d = drag;
    if (!d || ev.pointerId !== d.id) return;
    if (!d.on) {                                      // moved before the half second: a swipe, not a hold
      if (Math.abs(ev.clientX - d.x) > 8 || Math.abs(ev.clientY - d.y) > 8) { clearTimeout(d.timer); drag = null; }
      return;
    }
    const c = d.card, prev = c.previousElementSibling, next = c.nextElementSibling;
    c.style.transform = '';
    const mid = el => el.getBoundingClientRect().top + el.offsetHeight / 2;
    if (prev && prev.matches('.card[data-card]') && ev.clientY < mid(prev)) main.insertBefore(c, prev);
    else if (next && next.matches('.card[data-card]') && ev.clientY > mid(next)) main.insertBefore(next, c);
    c.style.transform = `translateY(${ev.clientY - d.grab - c.getBoundingClientRect().top}px)`;
    if (ev.clientY < 60) scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) scrollBy(0, 12);
  });
  addEventListener('pointerup', ev => { if (drag && ev.pointerId === drag.id) endDrag(true); });
  addEventListener('pointercancel', ev => { if (drag && ev.pointerId === drag.id) endDrag(drag.on); });
  addEventListener('touchmove', ev => { if (drag && drag.on) ev.preventDefault(); }, { passive: false });

  // ---- To-dos (2026-11-02: the desk widget's look, his ask): from the top, the month (when ▦ opens it, or while
  // typing a to-do), today and the next two days as meters (how many to-dos, filling as they're done; ▦ beside
  // them), then the day's open to-dos as bars and the dashed bar. A bar: the day's color at its edge (today
  // amber, other days blue); its box ticks it: it fills with its color, stays a moment, fades out, gone (ticked again
  // meanwhile: undone); its words change it in place, its day picked in the month. The dashed bar: a new one for
  // the day shown (another: tap it in the month). Hold / right-click a to-do: its card (done, delete). A monthly one
  // still to come: faint, ↻. Consolas, the widget's colors (Core.todoDays counts for both).
  const AMB = '#FFB547', BLU = '#2E7BFF', FADE_MS = 2300;
  // the day shown (null = today), the month open, which month, the to-do being typed { id ('' = new), on, text }, the
  // ticked ones fading out (id -> when)
  const td = { day: null, open: false, month: null, typing: null, fading: new Map() };
  const tdDay = () => td.day || Core.today();
  const dayLabel = d => `${WD[Core.weekday(d)].toUpperCase()} ${+d.slice(8)}`;
  const monthStart = m => { const d = m + '-01'; return Core.addDays(d, -((Core.weekday(d) + 6) % 7)); };
  const late = (d, now) => '‹ ' + (Core.diffDays(d, now) < 7 ? WD[Core.weekday(d)] : `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`);

  function todoCard(now) {
    const sel = tdDay(), tp = td.typing, picked = tp ? tp.on : sel, soon = Core.addDays(now, 2), color = sel === now ? AMB : BLU;
    const v = Core.todoDays(Store.todo(), now, sel, sel < now ? sel : now, sel > soon ? sel : soon);
    const bar = t => {
      if (t.rep) return `<div class="tdbar rep" style="--c:${color}"><span class="tdw">${esc(t.text)}</span><span class="tdr">↻</span></div>`;
      if (tp && tp.id === t.id) return typingBar();
      const f = td.fading.get(t.id), was = !t.done && t.on < now && sel === now ? `<span class="tdlate">${late(t.on, now)}</span>` : '';
      return `<div class="tdbar${f ? ' gone' : ''}" style="--c:${color}${f ? `;--d:${f - Date.now()}ms` : ''}">` +
        `<button class="tdw" data-tedit="${t.id}" data-todo="${t.id}">${esc(t.text)}</button>${was}` +
        `<button class="tdx" data-ttick="${t.id}" aria-label="${f ? 'Not done' : 'Done'}">${f ? '✓' : ''}</button></div>`;
    };
    const meter = (d, i) => {
      const c = v.days[d] || [0, 0, 0];
      return `<button class="tdmt${d === picked ? ' sel' : ''}" data-tpick="${d}" style="--c:${i ? BLU : AMB};--f:${c[0] ? Math.round(c[1] / c[0] * 100) : 0}%">` +
        `<span>${dayLabel(d)}</span><b>${c[0]}</b></button>`;
    };
    const list = v.list.filter(t => !t.done || td.fading.has(t.id));
    // (the page grows downward, so the mirror of the widget's order: the month and the days on top stay put, a longer
    // or shorter list only moves what's under it)
    return `<section class="card tdc" data-card="todo"><div class="tdtitle"><span class="title grip">to-do</span></div>` +
      (td.open || tp ? monthBlock(now, picked) : '') +
      `<div class="td3">${[now, Core.addDays(now, 1), soon].map(meter).join('')}` +
      `<button class="tdgb${td.open || tp ? ' on' : ''}" data-tgrid aria-label="Month">▦</button></div>` +
      `<div class="tdlist">${list.map(bar).join('')}` +
      (tp && !tp.id ? typingBar() : `<button class="tdnew" data-tnew>+ new${sel !== now ? ' for ' + WD[Core.weekday(sel)] + ' ' + +sel.slice(8) : ''}</button>`) +
      '</div></section>';
  }
  // the month: six weeks whatever the month (the same height, so ‹ › stay put); today outlined, the day picked
  // filled, a stripe under a day with something to do
  function monthBlock(now, picked) {
    const m = td.month || picked.slice(0, 7), first = monthStart(m), days = Core.todoDays(Store.todo(), now, '', first, Core.addDays(first, 41)).days;
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = Core.addDays(first, i), c = days[d];
      cells += `<button class="tdc1${d.slice(0, 7) !== m || d < now ? ' out' : ''}${d === now ? ' today' : ''}${d === picked ? ' sel' : ''}` +
        `${c && c[2] && d >= now ? ' has' : ''}" data-tpick="${d}">${+d.slice(8)}</button>`;
    }
    return `<div class="tdmon"><div class="tdmh"><span>${MONTHS_LONG[+m.slice(5) - 1].toUpperCase()} ${m.slice(0, 4)}</span>` +
      '<button class="tdar" data-tmon="-1" aria-label="Earlier month">‹</button><button class="tdar" data-tmon="1" aria-label="Later month">›</button></div>' +
      `<div class="tdgrid">${'MTWTFSS'.split('').map(l => `<span class="tdl">${l}</span>`).join('')}${cells}</div></div>`;
  }
  function typingBar() {
    const tp = td.typing;
    return `<div class="tdbar typing" style="--c:${tp.on === Core.today() ? AMB : BLU}"><input class="tdi" value="${esc(tp.text)}" ` +
      `aria-label="To-do" autocomplete="off" enterkeyhint="done"><span class="tdday">${dayLabel(tp.on)}</span></div>`;
  }

  // A day (in the month or the three): its to-dos. Typing a new one: the day it's for, and that day's to-dos show
  // above it (the words and the focus stay); nothing typed yet: just a day to look at, the month stays. Changing
  // one: its day (only the marks change).
  function pickTodoDay(d) {
    const now = Core.today(), f = main.querySelector('.tdi'), words = f ? f.value : '';
    if (td.typing && !td.typing.id && !words.trim()) { endTodo(false); td.open = true; }
    if (!td.typing) { td.day = d === now ? null : d; return render(); }
    td.typing.on = d;
    if (!td.typing.id) {
      td.typing.text = words; td.day = d === now ? null : d;
      render();
      const g = main.querySelector('.tdi');
      if (g) { g.focus(); g.setSelectionRange(g.value.length, g.value.length); }
      return;
    }
    main.querySelectorAll('[data-tpick]').forEach(b => b.classList.toggle('sel', b.dataset.tpick === d));
    const bar = main.querySelector('.tdbar.typing');
    if (bar) { bar.style.setProperty('--c', d === now ? AMB : BLU); bar.querySelector('.tdday').textContent = dayLabel(d); }
  }
  function stepMonth(dir) {
    td.month = Core.addDays((td.month || (td.typing ? td.typing.on : tdDay()).slice(0, 7)) + '-15', dir * 30).slice(0, 7);
    const box = main.querySelector('.tdmon');
    if (td.typing && box) box.outerHTML = monthBlock(Core.today(), td.typing.on); else render();
  }
  // Typing in place: a new one (the dashed bar; a day to come's date in the ledgers: one for it) or one's words
  function startTodo(date, id) {
    const t = id ? (Store.todo().items || []).find(x => x.id === id) : null;
    if (id && !t) return;
    td.typing = { id: id || '', on: t ? t.on : date || tdDay(), text: t ? t.text : '' };
    td.month = null;
    render();
    const f = main.querySelector('.tdi');
    if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }
  function endTodo(save) {
    const tp = td.typing, f = main.querySelector('.tdi');
    if (!tp) return;
    td.typing = null;
    td.day = tp.on === Core.today() ? null : tp.on;          // then the day it went to
    const text = f ? f.value.trim() : '', t = tp.id ? (Store.todo().items || []).find(x => x.id === tp.id) : null;
    quiet = true;
    if (save && text && !tp.id) Store.change(Core.newTodo(text, tp.on));
    else if (save && text && t) {
      const op = { type: 'todoEdit', id: t.id };
      if (text !== t.text) op.text = text;
      if (tp.on !== t.on) op.on = tp.on;
      if (op.text || op.on) Store.change(op);
    }
    quiet = false;
    render();
  }
  // Its box: done, the bar fills and fades out (FADE_MS), then the list closes up; again while it fades: undone
  function tickTodo(id) {
    const t = (Store.todo().items || []).find(x => x.id === id);
    if (!t) return;
    if (td.fading.has(id)) td.fading.delete(id);
    else if (!t.done) {
      const t0 = Date.now();
      td.fading.set(id, t0);
      setTimeout(() => {
        if (td.fading.get(id) !== t0) return;
        td.fading.delete(id);
        if (typing() || !pop.hidden) deferred = true; else render();
      }, FADE_MS);
    }
    Store.change({ type: 'todoDone', id, done: t.done ? null : Core.stamp() });
  }
  // while typing, a day, ‹ › or ▦ keeps the field's focus (and the phone's keyboard up)
  main.addEventListener('pointerdown', ev => { if (td.typing && ev.target.closest('[data-tpick], [data-tmon], [data-tgrid]')) ev.preventDefault(); });

  // A box. A powder taken shows its dose on it, in the middle, dark on the color (his pick of three, 2026-10-21).
  function box(r, c, list, color) {
    if (c.state === 'none' || c.state === 'off') return '<span class="sq"></span>';
    if (c.state === 'rest') return `<span class="sq s-rest" data-date="${c.date}" title="rest day"></span>`;
    const dose = r.powder && c.state === 'done' ? shortDose(c.dose) : '';
    return `<button class="sq s-${c.state}${c.note ? ' noted' : ''}${dose ? ' dz' : ''}" style="--c:${color}" ` +
      `data-id="${r.id}" data-list="${list}" data-date="${c.date}"${c.dose ? ` title="${esc(c.dose)}"` : ''}>${dose ? `<b>${dose}</b>` : ''}</button>`;
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

  // The day's heart rate as its lowest and highest ("pulse 44–152")
  function pulse(heart) {
    const v = Object.values(heart.hours || {});
    return v.length ? `<span>pulse ${Math.min(...v.map(x => x[0]))}–${Math.max(...v.map(x => x[1]))}</span>` : '';
  }

  function todayCard(data, date) {
    const day = Core.dayOf(data, date) || {}, pc = day.pc || {}, sl = sleepOn(data, date), sleep = day.sleep;
    const ct = Core.cardioTask(Store.config()), heart = day.heart;
    const pct = m => (m / 1440 * 100).toFixed(2) + '%';
    const bar = (a, b, cls, color) => `<i class="${cls}" style="left:${pct(a)};width:max(2px,${pct(b - a)})${color ? ';background:' + color : ''}"></i>`;
    const woke = sl.woke ?? 7 * 60, slept = sl.slept ?? 23 * 60;
    const nowMin = date === Core.today() ? new Date().getHours() * 60 + new Date().getMinutes() : null;
    let line = `<i class="awake" style="left:${pct(woke)};width:${pct(Math.max(0, slept - woke))}"></i>`;
    for (const [a, b] of sl.spans) line += bar(a, b, 'sl');
    for (const [a, b] of spansOf(pc.screen && pc.screen.at)) line += bar(a, b, 'scr');
    for (const w of pc.work || []) for (const [a, b] of spansOf(w.at)) line += bar(a, b, 'wk', w.color);
    // no heart rate on the line (2026-10-20, his call: his walks are always in the 110+ range, the marks said little)
    const mark = (m, real) => `<span class="mk${real ? ' real' : ''}" style="left:${pct(m)}"><b>${hm(m % 1440)}</b></span>`;
    if (nowMin != null) line += `<i class="now" style="left:${pct(nowMin)}"></i>`;
    const notes = Core.dayNotes(data, date);
    for (const n of notes) if (n.t) line += `<button class="nmk" style="left:${pct(toMin(n.t))}" data-note="${n.id}" data-ndate="${date}" aria-label="${n.t}"></button>`;
    const sums = [
      sleep && sleep.min ? `<span>slept ${hm(sleep.min)}</span>` : '',
      day.steps ? `<span>${Core.stepsOf(day).toLocaleString('en-US')} steps</span>` : '',
      heart ? (Core.cardioMin(ct, heart) != null ? `<span>cardio ${Core.cardioMin(ct, heart)} min</span>` : pulse(heart)) : '',
    ].join('');
    return `<section class="card today" data-card="today"><div class="th"><span class="title grip">today</span><span class="sums">${sums}</span></div>` +
      `<div class="dline" data-ldate="${date}">${line}</div>` +
      `<div class="marks">${mark(woke, sl.woke != null)}${mark(Math.min(slept, 1439), sl.slept != null)}</div>` +
      `<div class="hours">${hours()}</div></section>`;
  }

  // Screen time today, as the analysis shows it: the time at the computer, then each client's work
  function screenCard(data, date) {
    const pc = (Core.dayOf(data, date) || {}).pc || {};
    const nums = [
      pc.screen ? `<div><b>${hm(pc.screen.min)}</b><span>screen</span></div>` : '',
      ...(pc.work || []).map(w => `<div><b><i class="cdot" style="background:${esc(w.color)}"></i>${hm(w.min)}</b><span>${esc(w.client)}</span></div>`),
    ].join('');
    return `<section class="card" data-card="screen"><span class="title grip">screen time</span>` +
      (nums ? `<div class="anums">${nums}</div>` : '<p class="muted small">nothing yet today</p>') + '</section>';
  }

  // Gym (his note, 2026-11-02: "a separate node, functional, adding the session here directly"): today's exercises
  // and their sets (tap one: change it), + exercise (the picker, for today), progress; the week's count by the title
  function gymCard(data, date) {
    const t = (Store.config().tasks || []).find(x => x.kind === 'gym'), g = (Core.dayOf(data, date) || {}).gym, ex = (g && g.ex) || [];
    let last = '';
    if (!ex.length) for (let d = Core.addDays(date, -1), i = 0; i < 60 && !last; i++, d = Core.addDays(d, -1)) if ((Core.dayOf(data, d) || {}).gym) last = d;
    return `<section class="card gymc" data-card="gym" style="--c:${t ? colorOf(t) : GREEN}"><div class="th"><span class="title grip">gym</span>` +
      `<span class="sums">${t ? `<span>${Core.weekCount(t, data, date)}/${t.perWeek} this week</span>` : ''}</span></div>` +
      ex.map(e => `<button class="gx" data-gex="${esc(e.name)}"><span>${esc(e.name)}</span><small>${esc(fmtSets(e.sets))}</small></button>`).join('') +
      (!ex.length ? `<p class="muted small">${g ? 'went, no details' : last ? `nothing today · last: ${pretty(last)}` : 'nothing today'}</p>` : '') +
      '<div class="gxb"><button class="tdnew" data-gadd>+ exercise</button><button class="tdnew" data-act="progress">progress</button>' +
      '<button class="tdnew rtb" data-act="routines">routines</button></div></section>';
  }

  // The journal: a wide + on top opens the field for a new line; the newest line first (he asked 2026-10-19)
  function journalCard(data, date) {
    return `<section class="card" data-card="journal"><span class="title grip">journal</span>` +
      `<button class="jadd" data-jadd aria-label="Add to the journal">+</button>` +
      `<textarea class="dtext" id="dtext" rows="1" data-date="${date}" hidden></textarea>` +
      Core.dayNotes(data, date).slice().reverse().map(n => `<button class="jn" data-note="${n.id}" data-ndate="${date}"><span class="jt">${n.t || ''}</span>` +
        `<span class="jx">${esc(n.text)}</span></button>`).join('') + '</section>';
  }

  // A journal line: Enter (or leaving the field) adds it with the time it was written. The page redraws a
  // moment later, so a click that took the focus (a box) still lands.
  let quiet = false;
  // Every hour under the line (every other one on a phone)
  function hours() {
    const step = innerWidth < 500 ? 2 : 1;
    let out = '';
    for (let h = 0; h <= 24; h += step) out += `<span style="left:${(h / 24 * 100).toFixed(3)}%">${h}</span>`;
    return out;
  }

  const newNote = (date, t, text) => ({ type: 'dayNote', date, note: { id: Core.newId(), t, at: Core.stamp(), text } });
  function saveDayText(ta) {
    const text = ta.value.trim(), date = ta.dataset.date;
    if (!text) return;
    ta.value = '';
    quiet = true;
    Store.change(newNote(date, date === Core.today() ? Core.hhmm() : '', text));
    quiet = false;
    setTimeout(() => { if (deferred && !typing() && pop.hidden) render(); }, 300);
  }
  main.addEventListener('input', ev => { if (ev.target.matches('.dtext')) grow(ev.target); });
  // The wide + over the journal: the field takes its place; left empty, the + comes back
  function openJournal(b) {
    const ta = b.nextElementSibling;
    b.hidden = true;
    ta.hidden = false;
    grow(ta);
    ta.focus();
  }
  main.addEventListener('focusout', ev => {
    if (ev.target.matches('.dtext')) {
      saveDayText(ev.target);
      ev.target.hidden = true;
      ev.target.previousElementSibling.hidden = false;
    }
    if (ev.target.matches('.tdi')) endTodo(true);
  });
  main.addEventListener('keydown', ev => {
    if (ev.target.matches('.dtext') && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.target.blur(); }
    if (ev.target.matches('.tdi') && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && td.typing) {
      ev.preventDefault();
      pickTodoDay(Core.addDays(td.typing.on, ev.key === 'ArrowDown' ? 1 : -1));
    }
    if (ev.target.matches('.tdi') && (ev.key === 'Enter' || ev.key === 'Escape')) {
      ev.preventDefault();
      endTodo(ev.key === 'Enter');
    }
  });

  // ---- Taps

  function tap(el) {
    const { id, list, date } = el.dataset, cfg = Store.config(), data = Store.data(), now = Core.today();
    if (date > now) return;
    const s = list === 'supps' ? Core.find(cfg.supplements, id) : null, t = s ? null : Core.find(cfg.tasks, id);
    if (t && t.kind === 'gym') return openGym(date);
    const on = s ? !(Core.suppOf(s, data, date) || {}).taken : !Core.isDone(t, data, date);
    const write = dose => Store.change(s ? { type: 'supp', date, id, on, t: date === now ? Core.hhmm() : '', dose: dose != null ? dose : s.dose || '' }
      : { type: 'task', date, id, done: on });
    if (!on && date < now) return untickPop(el, s || t, date, () => write());
    if (on && s && s.powder) return dosePop(el, s, date, write);
    write();
  }

  // A powder: how much this time, last time's dose filled in. Enter (or a click elsewhere) ticks it with that dose;
  // Esc leaves it unticked. A bare number takes last time's unit ("0.3" -> "0.3 g").
  function dosePop(el, s, date, write) {
    const prev = Core.lastDose(s, Store.data(), date), unit = (/(m?g)\s*$/i.exec(prev) || [, 'g'])[1];
    openPop(el, `<div class="ph"><i style="background:${colorOf(s)}"></i>${esc(s.name)} · ${pretty(date)}</div>` +
      `<label class="dosel">dose<input class="dose" value="${esc(prev)}" inputmode="decimal" autocomplete="off"></label>`, {
      save: () => {
        let v = pop.querySelector('input.dose').value.trim().replace(',', '.');
        if (/^\d*\.?\d+$/.test(v)) v += ' ' + unit;
        write(v);
      },
    });
  }
  // "0.25 g" -> ".25", "5 g" -> "5": the number on a powder's box
  const shortDose = d => { const m = /\d*[.,]?\d+/.exec(String(d || '')); return m ? m[0].replace(',', '.').replace(/^0\./, '.') : ''; };

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
        if (text !== cur) Store.change({ type: list === 'supps' ? 'suppNote' : 'note', date, id, text, at: Core.stamp() });
      },
    });
  }

  // A date: that day's journal, and a line to add (no time: written afterwards); a day to come: a to-do for it
  const datePop = el => (el.dataset.day > Core.today() ? startTodo(el.dataset.day) : dayPop(el));
  function dayPop(el) {
    const date = el.dataset.day, notes = Core.dayNotes(Store.data(), date);
    openPop(el, `<div class="ph">${pretty(date)}</div>` +
      notes.map(n => `<button class="jn" data-pop="edit" data-note="${n.id}"><span class="jt">${n.t || ''}</span>` +
        `<span class="jx">${esc(n.text)}</span></button>`).join('') + '<textarea rows="1"></textarea>', {
      save: () => {
        const text = pop.querySelector('textarea').value.trim();
        if (text) Store.change(newNote(date, date === Core.today() ? Core.hhmm() : '', text));
      },
      edit: b => { closePop(true); journalPop(el, date, b.dataset.note); },
    });
  }

  // One journal line: change it (Enter), or Delete
  function journalPop(el, date, id) {
    const n = Core.dayNotes(Store.data(), date).find(x => x.id === id);
    if (!n) return;
    openPop(el, `<div class="ph">${pretty(date)}${n.t ? ' · ' + n.t : ''}</div><textarea rows="1">${esc(n.text)}</textarea>` +
      '<div class="row end"><button class="btn small" data-pop="del">Delete</button></div>', {
      save: () => {
        const text = pop.querySelector('textarea').value.trim();
        if (text && text !== n.text) Store.change({ type: 'dayNote', date, note: Object.assign({}, n, { text }) });
      },
      del: b => {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Delete?'; return; }
        Store.change({ type: 'undayNote', date, id });
        closePop(false);
      },
    });
  }

  // A moment on the day line (right-click, long-press, Ctrl/Alt+click): a journal line for that time
  function momentPop(line, x) {
    const r = line.getBoundingClientRect(), date = line.dataset.ldate;
    const min = Math.max(0, Math.min(1435, Math.round((x - r.left) / r.width * 1440 / 5) * 5));
    const t = Core.pad(Math.floor(min / 60)) + ':' + Core.pad(min % 60);
    openPop(line, `<div class="ph">${pretty(date)} · ${t}</div><textarea rows="1"></textarea>`, {
      save: () => {
        const text = pop.querySelector('textarea').value.trim();
        if (text) Store.change(newNote(date, t, text));
      },
    });
  }

  // A to-do's card (hold it, right-click, Ctrl+click): change the words or the day, Save; Mark done / not done;
  // Delete. (Until 2026-11-02 the tick button said "Done", which read as "done changing": changes got ticked.)
  function todoPop(el) {
    const t = (Store.todo().items || []).find(x => x.id === el.dataset.todo);
    if (!t) return;
    const r = Core.repeatOf(Store.todo(), t);
    openPop(el, `<div class="ph">to-do${r ? ' · every month, the ' + nth(r.day) : ''}${t.done ? ' · done ' + pretty(t.done.slice(0, 10)) + ' ' + t.done.slice(11) : ''}</div>` +
      `<input class="nm" value="${esc(t.text)}" aria-label="To-do" autocomplete="off">${dayChips(t.on)}` +
      `<div class="row end"><button class="btn small" data-pop="del">Delete</button>` +
      `<button class="btn small" data-pop="toggle">${t.done ? 'Mark not done' : 'Mark done'}</button>` +
      `<button class="btn small primary" data-pop="ok">Save</button></div>`, {
      save: () => {
        const text = pop.querySelector('.nm').value.trim(), on = pickedDay(t.on), op = { type: 'todoEdit', id: t.id };
        if (text && text !== t.text) op.text = text;
        if (on !== t.on) op.on = on;
        if (op.text || op.on) Store.change(op);
      },
      toggle: () => { closePop(true); Store.change({ type: 'todoDone', id: t.id, done: t.done ? null : Core.stamp() }); },
      ok: () => closePop(true),
      del: b => {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Delete?'; return; }
        Store.change({ type: 'todoDel', id: t.id });
        closePop(false);
      },
      day: pickDay,
    });
  }
  const nth = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  // The day chips: today, tomorrow, the rest of the coming week, and a date field for any day
  function dayChips(sel) {
    const now = Core.today();
    let out = '<div class="chips">';
    for (let i = 0; i < 7; i++) {
      const d = Core.addDays(now, i);
      out += `<button class="chip${d === sel ? ' on' : ''}" data-pop="day" data-day="${d}">${i === 0 ? 'today' : i === 1 ? 'tomorrow' : WD[Core.weekday(d)]}</button>`;
    }
    return out + `<input type="date" class="dpick" value="${sel}" aria-label="Day"></div>`;
  }
  const pickedDay = def => (pop.querySelector('.dpick') || {}).value || def;
  function pickDay(b) {
    pop.querySelector('.dpick').value = b.dataset.day;
    pop.querySelectorAll('.chip[data-day]').forEach(x => x.classList.toggle('on', x === b));
    pop.querySelector('.nm').focus();
  }

  // A new task (daily, on a weekday, or on a weekday every other week) or supplement (with its dose).
  // Enter adds it.
  function addPop(el) {
    const list = el.dataset.add, wd = Core.WEEKDAYS[Core.weekday(Core.today())];
    const chips = list === 'supps' ? '<input class="dose" aria-label="Dose" autocomplete="off">' :
      '<div class="chips">' + [['daily', 'daily'], ['weekly', 'weekly'], ['weeks2', 'every 2 weeks']]
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
        // every other week starts on the next such day (a week from today if it's today)
        let first = Core.addDays(Core.today(), 1);
        while (Core.WEEKDAYS[Core.weekday(first)] !== day) first = Core.addDays(first, 1);
        Store.change(Core.newItem(cfg, 'tasks', name, kind === 'weekly' ? { kind: 'weekly', day } :
          kind === 'weeks2' ? { kind: 'weekly', day, weeks: 2, from: first } : { kind: 'daily' }));
      },
      kind: b => {
        pop.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b));
        pop.querySelector('.days').hidden = b.dataset.kind === 'daily';
        pop.querySelector('.nm').focus();
      },
      day: b => { pop.querySelectorAll('[data-day]').forEach(x => x.classList.toggle('on', x === b)); pop.querySelector('.nm').focus(); },
    });
  }

  // A name: edit it in place (Enter saves; emoji welcome), or archive the row.
  function namePop(el) {
    const { info: id, list } = el.dataset, item = Core.find(listOf(Store.config(), list), id);
    const which = list === 'supps' ? 'supplements' : 'tasks';
    const move = dir => {
      const op = Core.moveOp(Store.config(), which, id, dir);
      if (!op) return;
      closePop(true);
      Store.change(op);
      render();
      const again = main.querySelector(`.name[data-info="${id}"][data-list="${list}"]`);
      if (again) namePop(again);
    };
    openPop(el, `<input class="nm" value="${esc(item.name)}" aria-label="Name" autocomplete="off" autocapitalize="off">` +
      '<div class="row end"><button class="btn small" data-pop="up" aria-label="Move up">↑</button>' +
      '<button class="btn small" data-pop="down" aria-label="Move down">↓</button>' +
      '<span class="grow"></span><button class="btn small" data-pop="archive">Archive</button></div>', {
      save: () => {
        const name = pop.querySelector('input').value.trim();
        if (name && name !== item.name) Store.change({ type: 'rename', list: which, id, name });
      },
      up: () => move(-1),
      down: () => move(1),
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
  pop.addEventListener('change', ev => {
    if (ev.target.matches('.dpick')) pop.querySelectorAll('.chip[data-day]').forEach(x => x.classList.toggle('on', x.dataset.day === ev.target.value));
  });
  pop.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); closePop(false); }
    else if (ev.key === 'Enter' && !ev.shiftKey && /^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) {
      ev.preventDefault();
      if (popActs && popActs.enter) popActs.enter(); else closePop(true);
    }
  });
  // A click outside saves and closes it (and doesn't also tick a box)
  document.addEventListener('pointerdown', ev => {
    if (!pop.hidden && !pop.contains(ev.target)) { closePop(true); swallowClick = true; }
  }, true);

  // ---- Clicks, right-clicks, long presses on the page

  let press = null;
  main.addEventListener('pointerdown', ev => {
    const el = ev.target.closest('.sq[data-id], .sq[data-hrow], .dh, .name, [data-todo], .dline');
    if (!el || ev.pointerType === 'mouse' || (el.matches('.dh') && el.dataset.day > Core.today())) return;
    press = { el, x: ev.clientX, y: ev.clientY, long: false };
    press.timer = setTimeout(() => { press.long = true; longPress(el, press.x); }, 450);
  });
  const cancelPress = () => { if (press) clearTimeout(press.timer); };
  main.addEventListener('pointermove', ev => { if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancelPress(); });
  main.addEventListener('pointerup', cancelPress);
  main.addEventListener('pointercancel', cancelPress);

  function longPress(el, x) {
    if (el.dataset.todo) todoPop(el);
    else if (el.dataset.hrow) healthNotePop(el);
    else if (el.matches('.dline')) momentPop(el, x);
    else if (el.matches('.sq')) notePop(el); else if (el.matches('.dh')) datePop(el); else namePop(el);
  }

  main.addEventListener('contextmenu', ev => {
    const el = ev.target.closest('.sq[data-id], .sq[data-hrow], .dh, .name, [data-todo], .dline');
    if (!el) return;
    ev.preventDefault();
    if (!press || !press.long) longPress(el.matches('.nmk') ? el.parentNode : el, ev.clientX);
  });

  main.addEventListener('click', ev => {
    if (swallowClick) { swallowClick = false; return; }
    const line = ev.target.closest('.dline');
    if (line && !ev.target.closest('button') && (ev.ctrlKey || ev.altKey || ev.metaKey)) return momentPop(line, ev.clientX);
    const el = ev.target.closest('button');
    if (!el) return;
    if (press && press.long && press.el === el) { press = null; return; }
    press = null;
    const ds = el.dataset;
    if (ds.tpick) return pickTodoDay(ds.tpick);
    if (ds.tmon) return stepMonth(+ds.tmon);
    if ('tgrid' in ds) { if (td.typing) { endTodo(true); td.open = true; } td.open = !td.open; td.month = null; return render(); }
    if (ds.ttick) return tickTodo(ds.ttick);
    if (ds.tedit && !(ev.ctrlKey || ev.altKey || ev.metaKey)) return startTodo(null, ds.tedit);
    if ('tnew' in ds) return startTodo(tdDay());
    if (ds.todo) return todoPop(el);
    if (ds.note) return journalPop(el, ds.ndate, ds.note);
    if (ds.hrow) return ev.ctrlKey || ev.altKey || ev.metaKey ? healthNotePop(el) : null;
    if ('jadd' in ds) return openJournal(el);
    if (ds.id && ds.date) return ev.ctrlKey || ev.altKey || ev.metaKey ? notePop(el) : tap(el);
    if (ds.day) return datePop(el);
    if (ds.info) return namePop(el);
    if (ds.add) return addPop(el);
    if (ds.act === 'settings') return openSettings();
    if (ds.act === 'archive') return openSheet(archiveView);
    if (ds.act === 'progress') return openProgress(null);
    if (ds.act === 'routines') return openRoutines();
    if ('gadd' in ds) { openGym(Core.today()); gym.picking = true; return renderSheet(); }
    if (ds.gex) { openGym(Core.today()); gym.ex = ds.gex; return renderSheet(); }
  });

  // ---- Panels (gym, settings): a sheet over the page

  let sheetRender = null, sheetWide = false;
  function openSheet(fn, wide) {
    closePop(true);
    sheetRender = fn;
    sheetWide = !!wide;
    sheetEl.hidden = false;
    renderSheet();
    requestAnimationFrame(() => sheetEl.classList.add('show'));
  }
  function renderSheet() {
    if (!sheetRender) return;
    sheetEl.innerHTML = `<div class="panel${sheetWide ? ' wide' : ''}">${sheetRender()}</div>`;
    sheetEl.classList.toggle('top', sheetRender === gymView && gym.picking && !gym.ex);     // picking an exercise: up top
  }
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
  const parseKg = s => { s = String(s).trim().replace(',', '.'); const n = parseFloat(s); return s === '' || isNaN(n) || n <= 0 ? null : n; };
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
    Object.assign(gym, { date, ex: null, picking: false, search: '', next: null, armed: -1, editing: false });
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
  // gym.json: the exercises, with other names to find them by (also), upper body, lower body or additional
  // (category), done with your body weight (body: its kg is what you weigh, so the next set keeps today's), a line on how (how)
  const exInfo = name => (Store.gym().exercises || []).find(e => e.name === name) || null;
  const exFits = (name, q) => [name, ...((exInfo(name) || {}).also || [])].some(n => n.toLowerCase().includes(q));
  const gymDay = d => (Core.dayOf(Store.data(), d) || {}).gym || null;
  const exOf = (d, name) => ((gymDay(d) || {}).ex || []).find(e => e.name === name) || null;

  // ---- Gym progress (his pick of three drafts, 2026-11-02: "B", one exercise in depth). Every set as a dot (bigger
  // = more reps), the line = each session's heaviest set, a ring = heavier than ever before; under it the records.
  // Bodyweight exercises (no kg, or gym.json body: pull-ups) count reps instead of kg. His order and how many are
  // on the first page (the rest under "more") are in config.json "progress", so both devices show the same; each
  // exercise has its own color, by its place in that order (2026-11-02: "only a few on the first page", "each
  // exercise a different color", 3 months or all time only).
  const prog = { ex: null, period: 'all time', back: null, more: false };
  const PERIODS = [['3 months', 91], ['all time', 0]];
  const PCOLORS = ['#5DCAA5', '#7FA7D9', '#EFC26B', '#ED93B1', '#AFA9EC', '#F0997B', '#9FD36B', '#6CC4D4', '#D9A0E8', '#E8D36B', '#C4A98A', '#8FB8A8'];
  function openProgress(ex) {
    Object.assign(prog, { ex: ex || null, back: sheetRender, more: false });
    if (!sheetRender) openSheet(progressView);
    else { sheetRender = progressView; sheetWide = false; renderSheet(); }
  }
  // name -> { reps, s: [[date, heaviest kg (or most reps), its reps, sets]] }, oldest first
  function progressData() {
    const out = {};
    for (const [name, l] of Object.entries(gymHistory())) {
      const all = l.map(x => ({ date: x.date, sets: (x.sets || []).filter(t => t && (t[0] != null || t[1] != null)) })).filter(x => x.sets.length);
      const reps = !!(exInfo(name) || {}).body || all.every(x => x.sets.every(t => !(t[0] > 0)));
      const s = [];
      for (const x of all) {
        if (reps) { const r = Math.max(...x.sets.map(t => t[1] || 0)); if (r > 0) s.push([x.date, r, r, x.sets]); continue; }
        const w = x.sets.filter(t => t[0] > 0);
        if (w.length) { const top = w.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && (b[1] || 0) > (a[1] || 0)) ? b : a)); s.push([x.date, top[0], top[1] || 0, x.sets]); }
      }
      if (s.length) out[name] = { reps, s };
    }
    return out;
  }
  // His order (config "progress"), then the rest, most done first; the first `first` of them on the first page
  function progOrder(all) {
    const p = Store.config().progress || {}, order = (p.order || []).filter(n => all[n]);
    for (const n of Object.keys(all).sort((a, b) => all[b].s.length - all[a].s.length || (a < b ? -1 : 1))) if (!order.includes(n)) order.push(n);
    return { order, first: Math.min(p.first ?? 5, order.length) };
  }
  const pcolor = (order, n) => PCOLORS[Math.max(0, order.indexOf(n)) % PCOLORS.length];
  const dm = d => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
  const n1 = v => String(Math.round(v * 10) / 10);
  function progressView() {
    const all = progressData(), { order, first } = progOrder(all);
    if (!all[prog.ex]) prog.ex = order[0] || null;
    const head = `<div class="row">${prog.back ? '<button class="back" data-p="back" aria-label="Back">‹</button>' : ''}` +
      '<h3 class="grow">gym progress</h3><button class="x" data-close aria-label="Close">×</button></div>';
    if (!prog.ex) return head + '<p class="muted">No sets written down yet.</p>';
    const chip = n => `<button class="chip pch${n === prog.ex ? ' on' : ''}" data-pex="${esc(n)}" style="--c:${pcolor(order, n)}"><i></i>${esc(n)}</button>`;
    const shown = order.slice(0, first), extra = shown.includes(prog.ex) ? [] : [prog.ex];
    const row = (n, i) => `<div class="prow"><button class="pname${n === prog.ex ? ' on' : ''}" data-pex="${esc(n)}" style="--c:${pcolor(order, n)}"><i></i>${esc(n)}</button>` +
      `<button class="pmv" data-pmv="${esc(n)}" data-dir="-1" aria-label="Up"${i ? '' : ' disabled'}>↑</button>` +
      `<button class="pmv" data-pmv="${esc(n)}" data-dir="1" aria-label="Down"${i < order.length - 1 ? '' : ' disabled'}>↓</button>` +
      `<button class="pmv${i < first ? ' on' : ''}" data-pst="${esc(n)}" aria-label="${i < first ? 'Off the first page' : 'On the first page'}">${i < first ? '★' : '☆'}</button></div>`;
    const E = all[prog.ex], days = PERIODS.find(p => p[0] === prog.period)[1];
    const S = days ? E.s.filter(x => x[0] > Core.addDays(Core.today(), -days)) : E.s;
    return head +
      `<div class="pex">${[...shown, ...extra].map(chip).join('')}` +
      `<button class="chip" data-pmore>${prog.more ? 'done' : `more · ${order.length - first}`}</button></div>` +
      (prog.more ? `<div class="plist"><h4>first page</h4>${order.slice(0, first).map((n, i) => row(n, i)).join('')}` +
        `<h4>more</h4>${order.slice(first).map((n, i) => row(n, i + first)).join('')}</div>` :
        `<div class="chips">${PERIODS.map(([k]) => `<button class="chip${k === prog.period ? ' on' : ''}" data-pp="${k}">${k}</button>`).join('')}</div>` +
        (S.length ? progChart(E, S, pcolor(order, prog.ex)) + progRecords(E, S) : `<p class="muted">No ${esc(prog.ex)} in the last 3 months.</p>`));
  }
  function progChart(E, S, c) {
    const W = 488, H = 230, L = 34, R = 10, T = 12, B = 24;
    const dots = S.flatMap(x => x[3].filter(t => (E.reps ? t[1] > 0 : t[0] > 0)).map(t => [x[0], E.reps ? t[1] : t[0], t[1] || 0]));
    let lo = Math.min(...dots.map(p => p[1])), hi = Math.max(...dots.map(p => p[1]));
    const r = hi - lo, step = r <= 12 ? 2 : r <= 30 ? 5 : r <= 80 ? 10 : r <= 200 ? 20 : 50;
    lo = Math.floor(lo / step) * step; hi = Math.max(lo + step, Math.ceil(hi / step) * step);
    const tm = d => Core.parse(d).getTime(), t0 = tm(S[0][0]), t1 = tm(S[S.length - 1][0]);
    const X = d => (t1 === t0 ? (L + W - R) / 2 : L + (tm(d) - t0) / (t1 - t0) * (W - L - R)), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    let g = '';
    for (let v = lo; v <= hi; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="pg"/><text x="${L - 6}" y="${Y(v) + 4}" class="pt" text-anchor="end">${v}</text>`;
    // under it: the months, or for a short span the Mondays
    const long = (t1 - t0) / 864e5 > 50;
    for (let d = S[0][0]; d <= S[S.length - 1][0]; d = Core.addDays(d, 1)) {
      if (long ? d.slice(8) === '01' : Core.weekday(d) === 1) g += `<text x="${X(d)}" y="${H - 6}" class="pt" text-anchor="middle">${long ? MONTHS[+d.slice(5, 7) - 1] : dm(d)}</text>`;
    }
    for (const p of dots) g += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${(1.6 + Math.min(p[2], 20) / 6).toFixed(1)}" fill="${c}" opacity=".22"/>`;
    g += `<polyline fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" points="${S.map(x => X(x[0]).toFixed(1) + ',' + Y(x[1]).toFixed(1)).join(' ')}"/>`;
    let best = Math.max(-1, ...E.s.filter(x => x[0] < S[0][0]).map(x => x[1]));
    for (const x of S) {
      const ring = best >= 0 && x[1] > best;
      best = Math.max(best, x[1]);
      g += `<circle cx="${X(x[0])}" cy="${Y(x[1])}" r="2.6" fill="${c}"><title>${dm(x[0])}: ${E.reps ? x[1] + ' reps' : n1(x[1]) + ' kg × ' + x[2]}</title></circle>` +
        (ring ? `<circle cx="${X(x[0])}" cy="${Y(x[1])}" r="5.5" fill="none" stroke="${c}" stroke-width="1.2"/>` : '');
    }
    return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(prog.ex)}: the heaviest set of each session">${g}</svg>`;
  }
  function progRecords(E, S) {
    const z = S[S.length - 1], a = S[0], set = x => (E.reps ? `${x[1]} reps` : `${n1(x[1])} kg × ${x[2]}`);
    const top = S.reduce((p, x) => (x[1] > p[1] || (x[1] === p[1] && x[2] > p[2]) ? x : p));
    const rows = [[E.reps ? 'most reps' : 'heaviest', `${set(top)} · ${dm(top[0])}`], ['first', `${set(a)} · ${dm(a[0])}`], ['last', `${set(z)} · ${dm(z[0])}`]];
    if (!E.reps) {
      const e1 = x => x[1] * (1 + x[2] / 30), b1 = S.reduce((p, x) => (e1(x) > e1(p) ? x : p));
      const vol = x => x[3].reduce((n, t) => n + (t[0] > 0 ? t[0] * (t[1] || 0) : 0), 0), bv = S.reduce((p, x) => (vol(x) > vol(p) ? x : p));
      rows.push(['one rep, estimated', `${Math.round(e1(b1))} kg · ${dm(b1[0])}`], ['most lifted in a session', `${Math.round(vol(bv)).toLocaleString('en-US')} kg · ${dm(bv[0])}`]);
    }
    rows.push(['sessions', String(S.length)]);
    return `<div class="prec">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>`;
  }
  // ↑ ↓ swap with the neighbour (across the line: in and out of the first page); ★ on / off the first page
  function progMove(name, dir) {
    const { order, first } = progOrder(progressData()), i = order.indexOf(name);
    let f = first;
    if (!dir) {
      order.splice(i, 1);
      if (i < f) order.splice(--f, 0, name); else order.splice(f++, 0, name);
    } else {
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
    }
    Store.change({ type: 'progress', order, first: f });
  }
  function progClick(el) {
    const ds = el.dataset, panel = sheetEl.querySelector('.panel'), top = panel ? panel.scrollTop : 0;
    if (ds.p === 'back') { sheetRender = prog.back; sheetWide = prog.back === analysisView; prog.back = null; return renderSheet(); }
    if (ds.pex) { prog.ex = ds.pex; if (prog.more && el.matches('.pname')) prog.more = false; }
    else if (ds.pp) prog.period = ds.pp;
    else if ('pmore' in ds) prog.more = !prog.more;
    else if (ds.pmv) progMove(ds.pmv, +ds.dir);
    else if (ds.pst) progMove(ds.pst, 0);
    else return;
    renderSheet();
    const p2 = sheetEl.querySelector('.panel');
    if (p2 && (ds.pmv || ds.pst)) p2.scrollTop = top;
  }

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

  // Picking one: the sheet sits at the top of the screen, so the keyboard never covers the list; the search, then
  // the exercises as buttons, just names, the latest first, under tabs: gym.json's categories (upper body, lower
  // body, additional), the last one picked kept on this device (prefs.gymTab). A search looks in all of them, under
  // their names; exercises only in the history (an old gym's machines) show when the search finds them, last.
  function pickerView() {
    return `<div class="row"><button class="back" data-g="back" aria-label="Back">‹</button>` +
      `<input id="search" aria-label="Find or add an exercise" autocomplete="off" autocapitalize="off" value="${esc(gym.search)}"></div>` +
      `<div id="picklist">${pickList()}</div>`;
  }

  function pickList() {
    const hist = gymHistory(), q = gym.search.trim().toLowerCase(), cat = Store.gym().exercises || [];
    const last = n => (hist[n] ? hist[n][hist[n].length - 1].date : '');
    const hidden = Store.config().gymHidden || [];
    const names = [...new Set([...cat.map(e => e.name), ...(q ? Object.keys(hist) : [])])]
      .filter(n => (!q || exFits(n, q)) && !hidden.includes(n))
      .sort((a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0));
    const today = n => (hist[n] || []).some(x => x.date === gym.date);
    // editing (the "edit" chip): × on each, a tap takes it off the lists (the archive brings it back)
    const btn = n => gym.editing ? `<button class="pk hide" data-ghide="${esc(n)}">${esc(n)} ×</button>` :
      `<button class="pk${today(n) ? ' done' : ''}" data-pick="${esc(n)}">${esc(n)}</button>`;
    const tabs = Store.gym().categories || [];
    const catOf = n => { const c = (exInfo(n) || {}).category; return tabs.includes(c) ? c : ''; };
    const section = (c, head) => {
      const list = names.filter(n => catOf(n) === c);
      return list.length ? (head ? `<div class="pkh">${esc(head)}</div>` : '') + `<div class="pks">${list.map(btn).join('')}</div>` : '';
    };
    if (!q) {
      const tab = tabs.includes(prefs.gymTab) ? prefs.gymTab : (tabs[0] || '');
      return (tabs.length ? `<div class="chips pkt">${tabs.map(c => `<button class="chip${c === tab ? ' on' : ''}" data-gtab="${esc(c)}">${esc(c)}</button>`).join('')}` +
        `<button class="chip${gym.editing ? ' on' : ''}" data-gedit>${gym.editing ? 'done' : 'edit'}</button></div>` : '') +
        section(tab, '');
    }
    const add = !names.includes(q) ? `<button class="pk new" data-pick="${esc(q)}">+ ${esc(q)}</button>` : '';
    return tabs.map(c => section(c, c)).join('') + section('', tabs.length ? 'other' : '') +
      (add ? `<div class="pks">${add}</div>` : '');
  }

  // Next set: the same set from last time, else today's last set, else last time's last set. Done with your body
  // weight (pull-ups): the weight is today's, or the latest written down; it doesn't change between sets.
  function prefill(name, sets, prev) {
    const i = sets.length;
    let s = (prev && prev.sets[i]) || sets[sets.length - 1] || (prev && prev.sets[prev.sets.length - 1]) || [null, 10];
    if ((exInfo(name) || {}).body) s = [sets.length ? sets[sets.length - 1][0] : bodyWeight(gym.date), s[1]];
    return s;
  }
  // The latest body weight written down (as the kg of an exercise done with it) before date
  function bodyWeight(date) {
    let best = null;
    for (const [name, list] of Object.entries(gymHistory())) {
      if (!(exInfo(name) || {}).body) continue;
      for (const x of list) {
        const k = x.sets.map(s => s[0]).filter(k => k > 0).pop();
        if (x.date < date && k != null && (!best || x.date > best.date)) best = { date: x.date, k };
      }
    }
    return best ? best.k : null;
  }

  function exerciseView() {
    const e = exOf(gym.date, gym.ex), sets = (e && e.sets) || [], prev = previous(gym.ex, gym.date);
    const next = gym.next || prefill(gym.ex, sets, prev), how = (exInfo(gym.ex) || {}).how;
    return `<div class="row"><button class="back" data-g="back" aria-label="Back">‹</button><h3 class="grow">${esc(gym.ex)}</h3>` +
      `<button class="chip" data-g="progress">progress</button><button class="x" data-close aria-label="Close">×</button></div>` +
      (how ? `<p class="small how">${esc(how)}</p>` : '') +
      `<p class="muted small">${prev ? `last time, ${rel(prev.date)}: ${esc(fmtSets(prev.sets))}${prev.note ? ' · ' + esc(prev.note) : ''}` : 'first time'}</p>` +
      `<div id="exchart">${exChart()}</div>` +
      `<ol class="sets">${sets.map((s, i) => `<li><span><span class="n">${i + 1}</span>${kgText(s[0])} × ${s[1] ?? '?'}</span>` +
        `<button class="del${gym.armed === i ? ' armed' : ''}" data-del="${i}">${gym.armed === i ? 'delete?' : '✕'}</button></li>`).join('')}</ol>` +
      `<div class="steppers">
        <div class="stepper"><span class="lbl">kg<button class="bwb" data-bw aria-label="Bodyweight">BW</button></span><div class="ctl"><button data-step="kg,-1">−</button>` +
        `<input id="kg" inputmode="decimal" value="${kgText(next[0])}"><button data-step="kg,1">+</button></div></div>
        <div class="stepper"><span class="lbl">reps</span><div class="ctl"><button data-step="reps,-1">−</button>` +
        `<input id="reps" inputmode="numeric" value="${next[1] ?? ''}"><button data-step="reps,1">+</button></div></div>
      </div>` +
      `<button class="btn wide primary big" data-g="addset">Add set ${sets.length + 1}</button>` +
      (sets.length ? `<label>note<input id="exnote" value="${esc(e.note)}"></label>` : '');
  }

  // While putting the sets in (his pick G1, 2026-11-08: "see visually where the thing lands as I'm doing it"): the
  // heaviest set of each session in the last 3 months as a line (most reps, for the ones done without weight), the
  // best ever dashed, today's sets as amber dots on the right (bigger = more reps), and the set on the steppers as a
  // dotted ring that moves with them; "new best" when it would beat the best
  function exChart() {
    const all = progressData(), E = all[gym.ex], reps = E ? E.reps : !!(exInfo(gym.ex) || {}).body;
    const past = E ? E.s.filter(x => x[0] < gym.date) : [], S = past.filter(x => x[0] > Core.addDays(gym.date, -91));
    const e = exOf(gym.date, gym.ex), sets = (e && e.sets) || [], val = t => (t ? (reps ? t[1] : t[0]) || 0 : 0);
    const todays = sets.filter(t => val(t) > 0), next = gym.next || prefill(gym.ex, sets, previous(gym.ex, gym.date));
    const ghost = val(next) > 0 ? next : null;
    if (!S.length && !todays.length && !ghost) return '';
    const best = past.length ? Math.max(...past.map(x => x[1])) : null;
    const W = 340, H = 140, L = 30, R = 10, T = 14, B = 18, c = pcolor(progOrder(all).order, gym.ex), AMB = '#EFC26B';
    const vs = [...S.map(x => x[1]), ...todays.map(val), ...(ghost ? [val(ghost)] : []), ...(best != null ? [best] : [])];
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const r0 = hi - lo, stp = r0 <= 12 ? 2 : r0 <= 30 ? 5 : r0 <= 80 ? 10 : r0 <= 200 ? 20 : 50;
    lo = Math.floor(lo / stp) * stp; hi = Math.max(lo + stp, Math.ceil(hi / stp) * stp);
    const n = S.length + 1, X = i => (n === 1 ? W - R - 12 : L + 8 + i * (W - L - R - 20) / (n - 1)), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const rad = t => 2.4 + Math.min(t[1] || 0, 20) / 5;
    let g = '';
    for (let v = lo; v <= hi; v += stp) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="pg"/><text x="${L - 6}" y="${Y(v) + 4}" class="pt" text-anchor="end">${v}</text>`;
    if (best != null) g += `<line x1="${L}" x2="${W - R}" y1="${Y(best)}" y2="${Y(best)}" stroke="${c}" stroke-dasharray="4 4" stroke-width="1" opacity=".6"/>` +
      `<text x="${L + 4}" y="${Y(best) - 4}" class="pt" style="fill:${c}">best ${reps ? best : n1(best)}</text>`;
    if (S.length > 1) g += `<polyline fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" points="${S.map((x, i) => X(i).toFixed(1) + ',' + Y(x[1]).toFixed(1)).join(' ')}"/>`;
    S.forEach((x, i) => { g += `<circle cx="${X(i)}" cy="${Y(x[1])}" r="2.4" fill="${c}"/>`; });
    const x1 = X(n - 1);
    for (const t of todays) g += `<circle cx="${x1}" cy="${Y(val(t))}" r="${rad(t)}" fill="${AMB}" opacity=".85"/>`;
    if (ghost) {
      g += `<circle cx="${x1}" cy="${Y(val(ghost))}" r="${rad(ghost)}" fill="none" stroke="${AMB}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
      if (best != null && val(ghost) > best) g += `<text x="${x1 - rad(ghost) - 5}" y="${Y(val(ghost)) + 4}" class="pt" text-anchor="end" style="fill:${AMB}">new best</text>`;
    }
    if (S.length) g += `<text x="${X(0)}" y="${H - 4}" class="pt">${dm(S[0][0])}</text>`;
    g += `<text x="${W - R}" y="${H - 4}" class="pt" text-anchor="end" style="fill:${AMB}">${gym.date === Core.today() ? 'today' : dm(gym.date)}</text>`;
    return `<svg class="pchart exc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(gym.ex)}: the last 3 months and today">${g}</svg>`;
  }
  function liveChart() { const el = $('#exchart'); if (el) el.innerHTML = exChart(); }

  function step(field, dir) {
    const el = $('#' + field);
    if (field === 'kg') {
      // 2.5 kg a step, down to BW (no weight) and no further
      const k = Math.max(0, Math.round(((parseKg(el.value) ?? 0) + dir * 2.5) * 100) / 100);
      el.value = kgText(k === 0 ? null : k);
    }
    else el.value = Math.max(0, (parseInt(el.value, 10) || 0) + dir);
    gym.next = [parseKg($('#kg').value), parseInt($('#reps').value, 10)];
    liveChart();
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
    if (ds.gtab) { prefs.gymTab = ds.gtab; savePrefs(); $('#picklist').innerHTML = pickList(); return; }
    if ('gedit' in ds) { gym.editing = !gym.editing; $('#picklist').innerHTML = pickList(); return; }
    if (ds.ghide) { Store.change({ type: 'gymHide', name: ds.ghide, on: true }); $('#picklist').innerHTML = pickList(); return; }
    if (ds.pick) { gym.ex = ds.pick.trim().toLowerCase(); gym.picking = false; gym.search = ''; gym.next = null; gym.armed = -1; return renderSheet(); }
    if (ds.step) { const [f, dir] = ds.step.split(','); return step(f, +dir); }
    if ('bw' in ds) { $('#kg').value = 'BW'; gym.next = [null, parseInt($('#reps').value, 10)]; return liveChart(); }
    if (ds.del) return deleteSet(+ds.del);
    switch (ds.g) {
      case 'pick': gym.picking = true; gym.search = ''; return renderSheet();
      case 'progress': return openProgress(gym.ex);
      case 'back': if (gym.ex) gym.ex = null; else gym.picking = false; gym.next = null; return renderSheet();
      case 'addset': return addSet();
      case 'went': Store.change({ type: 'gymDay', date: gym.date, on: true }); return renderSheet();
      case 'notgym': Store.change({ type: 'gymDay', date: gym.date, on: false }); return renderSheet();
    }
  }

  // ---- Routines (his pick S2, 2026-11-08, under a button on the gym card): a cheat sheet to look up in the morning
  // or the evening, nothing to tick ("rather just have them as a list I can look up"): gym.json "routines", a colored
  // tab each; a tap on an exercise shows its how-to. Opens on morning before noon, evening from 6 pm, else the last tab.
  const rt = { tab: null, open: '' };
  function openRoutines() {
    const h = new Date().getHours();
    rt.tab = h < 12 ? 'morning' : h >= 18 ? 'evening' : prefs.routine || null;
    rt.open = '';
    openSheet(routinesView);
  }
  function routinesView() {
    const list = Store.gym().routines || [], cur = list.find(r => r.name === rt.tab) || list[0];
    if (!cur) return sheetHead('routines') + '<p class="muted">None yet.</p>';
    return sheetHead('routines') +
      `<div class="chips rtt">${list.map(r => `<button class="chip${r === cur ? ' on' : ''}" data-rt="${esc(r.name)}" style="--c:${r.color}">${esc(r.name)}</button>`).join('')}</div>` +
      (cur.when ? `<p class="muted small">${esc(cur.when)}</p>` : '') +
      cur.ex.map(([name, dose]) => {
        const how = (exInfo(name) || {}).how;
        return `<button class="rtr" data-rx="${esc(name)}" style="--c:${cur.color}"><span>${esc(name)}</span><small>${esc(dose)}</small>` +
          (rt.open === name && how ? `<em>${esc(how)}</em>` : '') + '</button>';
      }).join('');
  }
  function routinesClick(el) {
    const ds = el.dataset;
    if (ds.rt) { rt.tab = ds.rt; rt.open = ''; prefs.routine = ds.rt; savePrefs(); }
    else if (ds.rx) rt.open = rt.open === ds.rx ? '' : ds.rx;
    else return;
    renderSheet();
  }

  // ---- Analysis: everything for a week, a month or a year, archived things and done to-dos included

  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ana = { period: 'week', at: null };
  function openAnalysis() { ana.at = Core.today(); openSheet(analysisView, true); }

  function periodOf() {
    const at = ana.at;
    if (ana.period === 'week') {
      const a = Core.monday(at), b = Core.addDays(a, 6);
      return { a, b, label: `${pretty(a)} – ${pretty(b)}` };
    }
    if (ana.period === 'month') {
      const d = Core.parse(at.slice(0, 8) + '01');
      return { a: Core.ymd(d), b: Core.ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` };
    }
    return { a: at.slice(0, 4) + '-01-01', b: at.slice(0, 4) + '-12-31', label: at.slice(0, 4) };
  }
  function shiftPeriod(dir) {
    if (ana.period === 'week') ana.at = Core.addDays(ana.at, 7 * dir);
    else if (ana.period === 'month') { const d = Core.parse(ana.at.slice(0, 8) + '01'); d.setMonth(d.getMonth() + dir); ana.at = Core.ymd(d); }
    else ana.at = (+ana.at.slice(0, 4) + dir) + '-07-01';
  }

  // The numbers for the period (days after today don't count)
  function stats() {
    const cfg = Store.config(), data = Store.data(), now = Core.today(), per = periodOf();
    const all = [];
    for (let d = per.a; d <= per.b; d = Core.addDays(d, 1)) all.push(d);
    const days = all.filter(d => d <= now);
    const alive = item => days.some(d => Core.statusOn(item, d) === 'active');
    // before it was tracked: empty, unless ticked anyway
    const cellOf = (t, d) => (d > now ? 'future' : Core.statusOn(t, d) == null ? (Core.isDone(t, data, d) ? 'done' : 'off') : Core.cell(t, data, d, now, cfg));
    const tasks = (cfg.tasks || []).filter(alive).map(t => {
      const cells = all.map(d => cellOf(t, d));
      let due = cells.filter(c => /^(done|flag|missed|todo)$/.test(c)).length;
      if (t.kind === 'gym') due = Math.round(t.perWeek * days.filter(d => Core.statusOn(t, d) === 'active').length / 7);
      if (t.kind === 'record' || t.must === false) due = null;
      return { item: t, cells, done: days.filter(d => Core.isDone(t, data, d)).length, due, archived: Core.statusOn(t, now) !== 'active' };
    });
    const supps = (cfg.supplements || []).filter(alive).map(sp => {
      const cells = all.map(d => (d > now ? 'future' : (Core.suppOf(sp, data, d) || {}).taken ? 'done' : Core.statusOn(sp, d) === 'active' ? 'open' : 'off'));
      return { item: sp, cells, done: cells.filter(c => c === 'done').length, due: days.filter(d => Core.statusOn(sp, d) === 'active').length,
        archived: Core.statusOn(sp, now) !== 'active' };
    });
    const items = Store.todo().items || [];
    const todosDone = items.filter(t => t.done && t.done.slice(0, 10) >= per.a && t.done.slice(0, 10) <= per.b);
    const todosOpen = items.filter(t => !t.done && t.on <= per.b).sort((x, y) => (x.on < y.on ? -1 : x.on > y.on ? 1 : 0));
    const out = Object.assign({}, per, { all, days, tasks, supps, todosDone, todosOpen, screen: 0, pcDays: 0, clients: {}, sleepMin: 0, nights: 0, gym: 0, steps: 0, stepDays: 0, cardio: 0, heartDays: 0, notes: [], boxNotes: [] });
    const ct = Core.cardioTask(cfg);
    for (const d of days) {
      const day = Core.dayOf(data, d) || {};
      if (day.pc) {
        out.pcDays++;
        out.screen += (day.pc.screen && day.pc.screen.min) || 0;
        for (const w of day.pc.work || []) (out.clients[w.client] = out.clients[w.client] || { min: 0, color: w.color }).min += w.min;
      }
      if (day.sleep && day.sleep.min) { out.nights++; out.sleepMin += day.sleep.min; }
      if (Core.stepsOf(day)) { out.stepDays++; out.steps += Core.stepsOf(day); }
      if (day.heart && Core.cardioMin(ct, day.heart) != null) { out.heartDays++; out.cardio += Core.cardioMin(ct, day.heart); }
      if (day.gym) out.gym++;
      for (const n of Core.dayNotes(data, d)) out.notes.push(Object.assign({ d }, n));
      for (const [kind, list] of [['tasks', cfg.tasks], ['supps', cfg.supplements]]) {
        for (const id in day[kind] || {}) {
          const e = day[kind][id], item = Core.find(list, id);
          if (e.note) out.boxNotes.push({ d, name: item ? item.name : id, text: e.note });
        }
      }
      for (const k in day.health || {}) if (day.health[k].note) out.boxNotes.push({ d, name: k, text: day.health[k].note });
    }
    return out;
  }

  function analysisView() {
    const st = stats(), cls = ana.period;
    const pad = cls === 'year' ? '<span class="as"></span>'.repeat((Core.weekday(st.a) + 6) % 7) : '';
    const strip = (cells, color) => `<div class="astrip ${cls}">${pad}${cells.map(c => `<span class="as s-${c}" style="--c:${color}"></span>`).join('')}</div>`;
    const row = r => `<div class="arow2"><div class="an"><i style="background:${colorOf(r.item)}"></i>${esc(r.item.name)}` +
      `${r.archived ? ' <span class="tag">archived</span>' : ''}</div><div class="acount">${r.done}${r.due != null ? ' / ' + r.due : ''}</div>` +
      `${strip(r.cells, colorOf(r.item))}</div>`;
    const list = (title, html) => (html ? `<h4>${title}</h4>${html}` : '');
    const clients = Object.entries(st.clients).sort((x, y) => y[1].min - x[1].min);
    const nums = [
      st.pcDays ? `<div><b>${hm(st.screen)}</b><span>screen · ${hm(st.screen / st.pcDays)} a day</span></div>` : '',
      ...clients.map(([c, v]) => `<div><b><i class="cdot" style="background:${esc(v.color)}"></i>${hm(v.min)}</b><span>${esc(c)}</span></div>`),
      st.nights ? `<div><b>${hm(st.sleepMin / st.nights)}</b><span>sleep, ${st.nights} night${st.nights > 1 ? 's' : ''}</span></div>` : '',
      st.gym ? `<div><b>${st.gym}</b><span>gym sessions</span></div>` : '',
      st.stepDays ? `<div><b>${Math.round(st.steps / st.stepDays).toLocaleString('en-US')}</b><span>steps a day</span></div>` : '',
      st.heartDays ? `<div><b>${Math.round(st.cardio / st.heartDays)} min</b><span>cardio a day</span></div>` : '',
    ].join('');
    return `<div class="sh"><span>analysis</span><button class="x" data-close aria-label="Close">×</button></div>` +
      `<div class="aperiod">${['week', 'month', 'year'].map(k => `<button class="chip${k === cls ? ' on' : ''}" data-a="${k}">${k}</button>`).join('')}` +
      `<span class="grow"></span><button class="back" data-a="prev" aria-label="Earlier">‹</button><span class="alabel">${st.label}</span>` +
      `<button class="back" data-a="next" aria-label="Later">›</button></div>` +
      (nums ? `<div class="anums">${nums}</div>` : '') +
      list('tasks', st.tasks.map(row).join('')) +
      list('supplements', st.supps.map(row).join('')) +
      list('to-dos done', st.todosDone.map(t => `<div class="aline"><span class="jt">${pretty(t.done.slice(0, 10))}</span>${esc(t.text)}</div>`).join('')) +
      list('to-dos still open', st.todosOpen.map(t => `<div class="aline"><span class="jt">${pretty(t.on)}</span>${esc(t.text)}</div>`).join('')) +
      list('journal', st.notes.map(n => `<div class="aline"><span class="jt">${pretty(n.d)}${n.t ? ' ' + n.t : ''}</span>${esc(n.text)}</div>`).join('')) +
      list('notes on boxes', st.boxNotes.map(n => `<div class="aline"><span class="jt">${pretty(n.d)}</span>${esc(n.name)}: ${esc(n.text)}</div>`).join('')) +
      '<div class="row end"><span class="muted small acopied"></span><button class="btn" data-a="gym">gym progress</button>' +
      '<button class="btn" data-a="copy">Copy for Claude</button></div>';
  }

  // The period as plain text, to paste into a chat with Claude
  function analysisText() {
    const st = stats(), lines = [`My daily tracker, ${st.label} (today is ${pretty(Core.today())}).`, ''];
    const days = r => st.all.filter((d, i) => r.cells[i] === 'done' || r.cells[i] === 'flag').map(d => pretty(d)).join(', ');
    lines.push('Tasks (done / due):');
    for (const r of st.tasks) lines.push(`- ${r.item.name}${r.archived ? ' (archived)' : ''}: ${r.done}${r.due != null ? ' / ' + r.due : ''}${r.done ? ' — ' + days(r) : ''}`);
    lines.push('', 'Supplements (days taken / days tracked):');
    for (const r of st.supps) lines.push(`- ${r.item.name} ${r.item.dose || ''}: ${r.done} / ${r.due}`);
    if (st.pcDays) {
      lines.push('', `Computer: screen ${hm(st.screen)} over ${st.pcDays} days (${hm(st.screen / st.pcDays)} a day)` +
        Object.entries(st.clients).map(([c, v]) => `; ${c} ${hm(v.min)}`).join(''));
    }
    if (st.nights) lines.push(`Sleep: ${hm(st.sleepMin / st.nights)} on average over ${st.nights} nights`);
    if (st.gym) lines.push(`Gym: ${st.gym} sessions`);
    if (st.stepDays) lines.push(`Steps: ${Math.round(st.steps / st.stepDays)} a day on average over ${st.stepDays} days (the band's count and ${Core.HOME_STEPS} at home without it)`);
    if (st.heartDays) {
      const ct = Core.cardioTask(Store.config());
      lines.push(`Cardio (heart rate ${(ct && ct.bpm) || 110}+ bpm, Apple Health): ${Math.round(st.cardio / st.heartDays)} min a day on average over ${st.heartDays} days` +
        (ct ? `, goal ${ct.min || 30} min` : ''));
    }
    if (st.todosDone.length) { lines.push('', 'To-dos done:'); for (const t of st.todosDone) lines.push(`- ${pretty(t.done.slice(0, 10))}: ${t.text}`); }
    if (st.todosOpen.length) { lines.push('', 'To-dos still open:'); for (const t of st.todosOpen) lines.push(`- since ${pretty(t.on)}: ${t.text}`); }
    if (st.notes.length) { lines.push('', 'Journal:'); for (const n of st.notes) lines.push(`- ${pretty(n.d)}${n.t ? ' ' + n.t : ''}: ${n.text}`); }
    if (st.boxNotes.length) { lines.push('', 'Notes on boxes:'); for (const n of st.boxNotes) lines.push(`- ${pretty(n.d)}, ${n.name}: ${n.text}`); }
    return lines.join('\n');
  }

  async function anaClick(el) {
    const a = el.dataset.a;
    if (a === 'gym') return openProgress(null);
    if (a === 'week' || a === 'month' || a === 'year') ana.period = a;
    else if (a === 'prev' || a === 'next') shiftPeriod(a === 'prev' ? -1 : 1);
    else if (a === 'copy') {
      const text = analysisText();
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      const note = sheetEl.querySelector('.acopied');
      if (note) note.textContent = 'copied: paste it into Claude';
      return;
    } else return;
    renderSheet();
  }

  // ---- The archive: what's archived or paused, to bring back (2026-11-02: a button at the bottom of the page; it
  // was in the settings, "clumsy", "clutters space there")

  const archivedItems = (cfg, now) => [...(cfg.tasks || []).map(t => ['tasks', t]), ...(cfg.supplements || []).map(t => ['supplements', t])]
    .filter(([, t]) => { const x = Core.statusOn(t, now); return x && x !== 'active'; });
  const nArchived = cfg => archivedItems(cfg, Core.today()).length + (cfg.gymHidden || []).length + (cfg.cardsHidden || []).length;
  function archiveView() {
    const now = Core.today(), l = archivedItems(Store.config(), now);
    const since = t => { const h = t.status || [], last = h[h.length - 1]; return last ? ` <span class="muted small">since ${dm(last[0])}</span>` : ''; };
    const part = list => {
      const rows = l.filter(([k]) => k === list);
      return rows.length ? `<h4>${list}</h4>` + rows.map(([k, t]) => `<div class="arow"><span><i class="cdot" style="background:${colorOf(t)}"></i>` +
        `${esc(t.name)}${since(t)}</span><button class="btn small" data-r="${k}" data-id="${t.id}">Bring back</button></div>`).join('') : '';
    };
    const gx = Store.config().gymHidden || [];
    const gyms = gx.length ? '<h4>gym exercises</h4>' + gx.map(n => `<div class="arow"><span>${esc(n)}</span>` +
      `<button class="btn small" data-gshow="${esc(n)}">Bring back</button></div>`).join('') : '';
    const ch = Store.config().cardsHidden || [];
    const cards = ch.length ? '<h4>page cards</h4>' + ch.map(k => `<div class="arow"><span>${esc(CARD_NAMES[k] || k)}</span>` +
      `<button class="btn small" data-cshow="${esc(k)}">Bring back</button></div>`).join('') : '';
    return sheetHead('archive') + (nArchived(Store.config()) ? part('tasks') + part('supplements') + gyms + cards : '<p class="muted">Nothing archived.</p>');
  }
  function archiveClick(el) {
    if (el.dataset.gshow) Store.change({ type: 'gymHide', name: el.dataset.gshow, on: false });
    else if (el.dataset.cshow) Store.change({ type: 'cardHide', card: el.dataset.cshow, on: false });
    else if (el.dataset.r) Store.change({ type: 'status', list: el.dataset.r, id: el.dataset.id, date: Core.today(), status: 'active' });
    else return;
    if (nArchived(Store.config())) renderSheet(); else closeSheet();
  }

  // ---- Settings: token, this device, colors

  function openSettings() { openSheet(settingsView); }

  function settingsView() {
    const s = Store.settings, st = Store.status();
    const last = st.last ? `Last synced ${Core.hhmm(new Date(st.last))}.` : '';
    return sheetHead('Settings') +
      (Store.LOCAL ? '<p class="muted small">Local test server: no token needed, data stays on this PC.</p>' :
        `<form id="tokform" onsubmit="return false"><input class="sr" autocomplete="username" value="daily-widget" tabindex="-1" aria-hidden="true">` +
        `<label>GitHub token<input id="token" type="password" autocomplete="current-password" value="${esc(s.token)}"></label></form>
        <p class="muted small">Fine-grained, for the daily-widget repo only, Contents: read and write. Save it in Passwords
        (user "daily-widget") and the field fills it in after a reinstall.
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create one on GitHub</a></p>`) +
      `<label>This device<input id="device" value="${esc(s.device)}"></label>` +
      `<label class="check"><input type="checkbox" id="colors"${prefs.colors ? ' checked' : ''}> A color per task (off: all green)</label>` +
      '<p class="muted small">To move a card, hold its title for half a second, then drag it. The order stays on this device.</p>' +
      `<p class="muted small">${st.error ? esc(st.error) + '. ' : ''}${last} ${Store.waiting() ? Store.waiting() + ' changes waiting.' : ''}</p>` +
      '<div class="row end"><button class="btn" data-s="sync">Sync now</button><button class="btn primary" data-s="save">Save</button></div>';
  }

  function settingsClick(el) {
    switch (el.dataset.s) {
      case 'sync': Store.sync(); return closeSheet();
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
    if (sheetRender === gymView) gymClick(el); else if (sheetRender === analysisView) anaClick(el);
    else if (sheetRender === progressView) progClick(el); else if (sheetRender === archiveView) archiveClick(el);
    else if (sheetRender === routinesView) routinesClick(el); else settingsClick(el);
  });
  sheetEl.addEventListener('input', ev => {
    const id = ev.target.id;
    if (id === 'search') { gym.search = ev.target.value; $('#picklist').innerHTML = pickList(); }
    if (id === 'kg' || id === 'reps') { gym.next = [parseKg($('#kg').value), parseInt($('#reps').value, 10)]; liveChart(); }
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
    if (id === 'search' && gym.search.trim()) { const first = $('#picklist .pk:not(.new)') || $('#picklist .pk.new'); if (first) first.click(); }
    else if (id === 'kg' || id === 'reps') addSet();
    else if (id === 'gnote' || id === 'exnote') ev.target.blur();
  });

  // ---- Keeping it current

  $('#gear').addEventListener('click', openSettings);
  $('#ana').addEventListener('click', openAnalysis);
  statusEl.addEventListener('click', () => (Store.ready() && Store.status().state !== 'error' ? Store.sync() : openSettings()));

  Store.onChange(what => {
    if (what === 'status') return renderStatus();
    if (!pop.hidden || typing() || quiet || (drag && drag.on)) { deferred = true; return renderStatus(); }
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
