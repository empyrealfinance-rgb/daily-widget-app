// The rules: what each square shows, and how a change is written into a month file or the config.
// Shared by the web app and the laptop desk widget (desk\daily_widget.ahk runs this file in
// Windows' built-in IE11 script engine), so ES5 only: var and function, no arrows, let,
// classes or template strings.

var Core = (function () {
  var WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // ---- Dates: 'YYYY-MM-DD' strings in local time; weeks start on Monday

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function today() { return ymd(new Date()); }
  function hhmm(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function weekday(s) { return parse(s).getDay(); }
  function monday(s) { return addDays(s, -((weekday(s) + 6) % 7)); }
  function monthOf(s) { return s.slice(0, 7); }
  function daysInMonth(s) { var d = parse(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

  // n whole weeks, Monday to Sunday, the last one being this week
  function weeks(now, n) {
    var start = addDays(monday(now), -7 * (n - 1)), out = [];
    for (var i = 0; i < 7 * n; i++) out.push(addDays(start, i));
    return out;
  }

  // The dates from a to b, both included
  function span(a, b) {
    var out = [];
    for (var d = a; d <= b; d = addDays(d, 1)) out.push(d);
    return out;
  }

  // ---- Lifecycle: item.status = [["2026-10-17", "active"], ["2026-12-01", "archived"], ...]
  // Before the first date it didn't exist yet. Only active items are on screen; the data stays.

  function statusOn(item, date) {
    var s = null, h = item.status || [];
    for (var i = 0; i < h.length; i++) if (h[i][0] <= date) s = h[i][1];
    return s;
  }
  function find(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }

  // ---- Tasks

  function dayOf(data, date) {
    var m = data[monthOf(date)];
    return (m && m.days && m.days[date]) || null;
  }

  function entryOf(task, data, date) {
    var d = dayOf(data, date);
    return (d && d.tasks && d.tasks[task.id]) || null;
  }

  function isDone(task, data, date) {
    var d = dayOf(data, date);
    if (!d) return false;
    if (task.kind === 'gym' && d.gym) return true;
    return !!(d.tasks && d.tasks[task.id] && d.tasks[task.id].done);
  }

  // The due window holding date, as [first, last] day, or null when the task isn't due that day.
  // weekly: on its day; with weeks: 2 (and from: its first date) every other week
  function windowOf(task, date) {
    if (task.kind === 'weekly') {
      var every = task.weeks > 1 && task.from ? 7 * task.weeks : 0;
      return WEEKDAYS[weekday(date)] === task.day && (!every || diffDays(task.from, date) % every === 0) ? [date, date] : null;
    }
    if (task.kind === 'every') {
      var start = addDays(task.from, Math.floor(diffDays(task.from, date) / task.days) * task.days);
      return [start, addDays(start, task.days - 1)];
    }
    if (task.kind === 'monthEnd') {
      var n = daysInMonth(date), first = n - task.days + 1;
      return +date.slice(8) >= first ? [date.slice(0, 8) + pad(first), date.slice(0, 8) + pad(n)] : null;
    }
    return [date, date];
  }

  function doneBetween(task, data, a, b) {
    for (var d = a; d <= b; d = addDays(d, 1)) if (isDone(task, data, d)) return true;
    return false;
  }

  // A record (caffeine) that broke its rule that day: not with `onlyWith` (gym), or two days in a row.
  function broken(task, data, date, config) {
    var other = task.onlyWith && find(config && config.tasks, task.onlyWith);
    if (other && !isDone(other, data, date)) return true;
    return !!task.notInARow && isDone(task, data, addDays(date, -1));
  }

  // What one square shows:
  //   done    the task's color
  //   flag    done, but against its rule (caffeine on a day without gym): color with a dot
  //   todo    today, still open
  //   missed  grey with a small dot
  //   open    possible that day, nothing to show (faint square, tappable)
  //   rest    gym after restAfter gym days in a row: a rest day, nothing to tick (done anyway: flag)
  //   future  a day still to come
  //   none    not due that day (no square)
  //   off     paused / archived then
  // Days before it was tracked can still be ticked afterwards: they show as done or open, never missed.
  function cell(task, data, date, now, config) {
    now = now || today();
    var st = statusOn(task, date), before = st === null && date <= now;
    if (st !== 'active' && !before) return 'off';
    var w = windowOf(task, date);
    if (!w) return 'none';
    var done = isDone(task, data, date);
    if (task.kind === 'gym' && mustRest(task, data, date)) return done ? 'flag' : 'rest';
    if (date > now) return done ? 'done' : 'future';
    if (task.kind === 'record') return !done ? 'open' : date < now && broken(task, data, date, config) ? 'flag' : 'done';
    if (done) return 'done';
    if (before || task.kind === 'gym' || task.must === false) return date === now ? 'todo' : 'open';
    if (w[0] !== w[1]) {
      // A window of several days (24h fast, month end): done once anywhere in it is enough.
      if (doneBetween(task, data, w[0], w[1] < now ? w[1] : now)) return 'open';
      if (date === now) return 'todo';
      return date === w[1] ? 'missed' : 'open';
    }
    return date === now ? 'todo' : 'missed';
  }

  // gym with restAfter: n: the day after n gym days in a row is a rest day
  function mustRest(task, data, date) {
    var n = task.restAfter || 0;
    if (!n) return false;
    for (var i = 1; i <= n; i++) if (!isDone(task, data, addDays(date, -i))) return false;
    return true;
  }

  function weekCount(task, data, date) {
    var m = monday(date), n = 0;
    for (var i = 0; i < 7; i++) if (isDone(task, data, addDays(m, i))) n++;
    return n;
  }

  // A few words beside the name: "2/3" (gym this week), "5 days left" (fast, month end), "in 7 days"
  // (every other week, till the next one).
  function hint(task, data, now) {
    now = now || today();
    if (task.kind === 'gym') return weekCount(task, data, now) + '/' + task.perWeek;
    if (task.kind === 'weekly' && task.weeks > 1 && task.from) {
      var every = 7 * task.weeks, k = diffDays(task.from, now), n = k < 0 ? -k : (every - k % every) % every;
      return n === 0 ? '' : n === 1 ? 'tomorrow' : 'in ' + n + ' days';
    }
    if (task.kind === 'every' || task.kind === 'monthEnd') {
      var w = windowOf(task, now);
      if (!w) return '';
      if (doneBetween(task, data, w[0], now)) return 'done';
      var left = diffDays(now, w[1]) + 1;
      return left === 1 ? 'last day' : left + ' days left';
    }
    return '';
  }

  function rowOf(item, cells, extra) {
    var r = { id: item.id, name: item.name, color: item.color || '', cells: cells };
    for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
    return r;
  }

  // The grid: one row per task active today (in config order), one cell per date.
  function rows(config, data, dates, now) {
    now = now || today();
    var out = [], tasks = config.tasks || [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], cells = [];
      if (statusOn(t, now) !== 'active') continue;
      for (var j = 0; j < dates.length; j++) {
        var e = entryOf(t, data, dates[j]);
        cells.push({ date: dates[j], state: cell(t, data, dates[j], now, config), note: (e && e.note) || '' });
      }
      out.push(rowOf(t, cells, { kind: t.kind, optional: t.must === false, hint: hint(t, data, now) }));
    }
    return out;
  }

  // Supplements: taken (with the time) or not; never "missed". Like tasks, days before one was
  // tracked can be ticked afterwards.
  function suppOf(s, data, date) {
    var d = dayOf(data, date);
    return (d && d.supps && d.supps[s.id]) || null;
  }
  function suppRows(config, data, dates, now) {
    now = now || today();
    var out = [], list = config.supplements || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], cells = [];
      if (statusOn(s, now) !== 'active') continue;
      for (var j = 0; j < dates.length; j++) {
        var e = suppOf(s, data, dates[j]), d = dates[j], on = statusOn(s, d);
        var st = on !== 'active' && !(on === null && d <= now) ? 'off' : e && e.taken ? 'done' : d > now ? 'future' : 'open';
        cells.push({ date: d, state: st, note: (e && e.note) || '', t: (e && e.t) || '' });
      }
      out.push(rowOf(s, cells, { kind: 'supplement', optional: false, hint: s.dose || '' }));
    }
    return out;
  }

  // ---- Changes to a month file ({ "days": { "2026-10-17": {...} } })
  // Every op can be applied twice safely: after a sync conflict it's applied again to the newer file.

  function apply(m, op) {
    m.days = m.days || {};
    var d = m.days[op.date] || (m.days[op.date] = {});
    var i, t, e = op.entry;
    // The first version wrote supplements and feelings as "log" entries: read those as the new kinds
    if (op.type === 'log' && e && e.kind === 'supplement') op = { type: 'supp', date: op.date, id: e.item, on: true, t: e.t, dose: e.dose };
    else if (op.type === 'log' && e) op = { type: 'dayNote', date: op.date, note: { id: e.id, t: e.t, text: e.text || '' } };
    if (op.type === 'task') {
      d.tasks = d.tasks || {};
      t = d.tasks[op.id] || (d.tasks[op.id] = {});
      if (op.done) t.done = true; else delete t.done;
    } else if (op.type === 'note') {
      d.tasks = d.tasks || {};
      t = d.tasks[op.id] || (d.tasks[op.id] = {});
      if (op.text) { t.note = op.text; if (op.at) t.noteAt = op.at; } else { delete t.note; delete t.noteAt; }
    } else if (op.type === 'supp') {
      d.supps = d.supps || {};
      t = d.supps[op.id] || (d.supps[op.id] = {});
      if (op.on) { t.taken = true; if (op.t) t.t = op.t; if (op.dose) t.dose = op.dose; }
      else { delete t.taken; delete t.t; delete t.dose; }
    } else if (op.type === 'suppNote') {
      d.supps = d.supps || {};
      t = d.supps[op.id] || (d.supps[op.id] = {});
      if (op.text) { t.note = op.text; if (op.at) t.noteAt = op.at; } else { delete t.note; delete t.noteAt; }
    } else if (op.type === 'dayText') {
      // The day's note: what it went into, how it went (one text per day). Older days had a list of
      // timed notes; writing the text takes those in.
      if (op.text) d.text = op.text; else delete d.text;
      delete d.notes;
    } else if (op.type === 'pc') {
      // The laptop's time tracker for that day (desk widget): screen time and client work
      if (op.pc) d.pc = op.pc; else delete d.pc;
    } else if (op.type === 'sleep') {
      if (op.sleep) d.sleep = op.sleep; else delete d.sleep;
    } else if (op.type === 'steps') {
      // Apple Health's step count for the day (the phone's Shortcut), the latest so far
      if (op.steps) d.steps = op.steps; else delete d.steps;
    } else if (op.type === 'healthSleep') {
      // Apple Health's In Bed times for the night ending that day, added to what's there (a later run only
      // adds); a night typed in from screenshots (with stages) is left as it is
      if (!(d.sleep && d.sleep.deep != null)) {
        var at = joinSpans(((d.sleep && d.sleep.at) || []).concat(op.at || []));
        d.sleep = d.sleep || {};
        d.sleep.at = at;
        d.sleep.min = spanMinutes(at);
        if (!d.sleep.from) d.sleep.from = 'Apple Health';
      }
    } else if (op.type === 'dayNote') {
      // How the day went: notes with the time they're about (when written, or a moment picked on the day
      // line); "" = no time (a summary). The older single text becomes the first of them.
      d.notes = d.notes || [];
      if (d.text) { d.notes.unshift({ id: 'day', t: '', text: d.text }); delete d.text; }
      for (i = 0; i < d.notes.length && d.notes[i].id !== op.note.id; i++);
      if (op.note.text) d.notes[i] = op.note; else if (i < d.notes.length) d.notes.splice(i, 1);
    } else if (op.type === 'unlog' || op.type === 'undayNote') {
      if (op.id === 'day') delete d.text;
      d.notes = (d.notes || []).filter(function (n) { return n.id !== op.id; });
      d.log = (d.log || []).filter(function (n) { return n.id !== op.id; });
    } else if (op.type === 'gymDay') {
      if (op.on) d.gym = d.gym || {}; else delete d.gym;
    } else if (op.type === 'gymNote') {
      d.gym = d.gym || {};
      if (op.text) d.gym.note = op.text; else delete d.gym.note;
    } else if (op.type === 'gymEx') {
      // The whole list of sets for one exercise that day; an empty list removes the exercise.
      d.gym = d.gym || {};
      var ex = d.gym.ex || [];
      for (i = 0; i < ex.length && ex[i].name !== op.name; i++);
      if (op.sets.length) {
        ex[i] = ex[i] || { name: op.name };
        ex[i].sets = op.sets;
        if (op.note !== undefined) { if (op.note) ex[i].note = op.note; else delete ex[i].note; }
      } else if (i < ex.length) ex.splice(i, 1);
      if (ex.length) d.gym.ex = ex; else delete d.gym.ex;
    }
    tidy(m, op.date);
    return m;
  }

  function isEmpty(o) { for (var k in o) if (o.hasOwnProperty(k)) return false; return true; }

  function tidy(m, date) {
    var d = m.days[date], k;
    for (var part in { tasks: 1, supps: 1 }) {
      if (!d[part]) continue;
      for (k in d[part]) if (d[part].hasOwnProperty(k) && isEmpty(d[part][k])) delete d[part][k];
      if (isEmpty(d[part])) delete d[part];
    }
    if (d.notes && !d.notes.length) delete d.notes;
    if (d.log && !d.log.length) delete d.log;
    if (isEmpty(d)) delete m.days[date];
  }

  // A ticked box on an earlier day: unticking it asks first (so a slip while ticking today's boxes
  // doesn't wipe a past day).
  function isSet(state) { return state === 'done' || state === 'flag'; }

  // The day's notes, by time; ones without a time (summaries) last
  function dayNotes(data, date) {
    var d = dayOf(data, date) || {}, out = [];
    if (d.text) out.push({ id: 'day', t: '', text: d.text });
    for (var i = 0; i < (d.notes || []).length; i++) out.push(d.notes[i]);
    return out.sort(function (a, b) { return (a.t || '99') < (b.t || '99') ? -1 : (a.t || '99') > (b.t || '99') ? 1 : 0; });
  }
  // ... as text, one per line ("14:32 text")
  function dayText(data, date) {
    var n = dayNotes(data, date), out = [];
    for (var i = 0; i < n.length; i++) out.push((n[i].t ? n[i].t + '  ' : '') + n[i].text);
    return out.join('\n');
  }

  // ---- Changes to config.json:
  //   { type: 'status', list: 'tasks'|'supplements', id, date, status }   archive, restore
  //   { type: 'rename', list, id, name }
  //   { type: 'add', list, item }                                          a new task or supplement
  //   { type: 'order', list, ids }                                         the list in this order

  function isConfigOp(op) { return op.type === 'status' || op.type === 'rename' || op.type === 'add' || op.type === 'order'; }

  // Moving an item up (dir -1) or down (1) past the next one on screen (archived ones stay where they are)
  function moveOp(c, list, id, dir, date) {
    var l = (c[list] || []).slice(), i = -1, j, k, ids = [];
    for (k = 0; k < l.length; k++) if (l[k].id === id) i = k;
    if (i < 0) return null;
    for (j = i + dir; j >= 0 && j < l.length && statusOn(l[j], date || today()) !== 'active'; j += dir);
    if (j < 0 || j >= l.length) return null;
    l.splice(j, 0, l.splice(i, 1)[0]);
    for (k = 0; k < l.length; k++) ids.push(l[k].id);
    return { type: 'order', list: list, ids: ids };
  }

  // Colors for new items: the first one no other item uses
  var COLORS = ['#ED93B1', '#9FE1CB', '#FAC775', '#85B7EB', '#F0997B', '#AFA9EC', '#C0DD97', '#F5C4B3', '#B5D4F4', '#D3D1C7',
    '#5DCAA5', '#EFC26B', '#97C459', '#C9A37A'];

  // A new item: id from the name (or random for emoji-only names), its own color, active from today
  function newItem(c, list, name, extra) {
    var all = (c.tasks || []).concat(c.supplements || []), used = {}, ids = {}, i, k;
    for (i = 0; i < all.length; i++) { used[(all[i].color || '').toUpperCase()] = 1; ids[all[i].id] = 1; }
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || newId(), id = base;
    for (i = 2; ids[id]; i++) id = base + '_' + i;
    var item = { id: id, name: name }, color = COLORS[0];
    for (i = 0; i < COLORS.length; i++) if (!used[COLORS[i]]) { color = COLORS[i]; break; }
    for (k in extra) if (extra.hasOwnProperty(k)) item[k] = extra[k];
    item.color = color;
    item.status = [[today(), 'active']];
    return { type: 'add', list: list, item: item };
  }

  function applyConfig(c, op) {
    var i;
    if (op.type === 'order') {
      var l = c[op.list] || [], byId = {}, out = [];
      for (i = 0; i < l.length; i++) byId[l[i].id] = l[i];
      for (i = 0; i < op.ids.length; i++) if (byId[op.ids[i]]) { out.push(byId[op.ids[i]]); delete byId[op.ids[i]]; }
      for (i = 0; i < l.length; i++) if (byId[l[i].id]) out.push(l[i]);
      c[op.list] = out;
      return c;
    }
    if (op.type === 'add') {
      c[op.list] = c[op.list] || [];
      if (!find(c[op.list], op.item.id)) c[op.list].push(op.item);
      return c;
    }
    var item = find(c[op.list], op.id);
    if (!item) return c;
    if (op.type === 'rename') { if (op.name) item.name = op.name; return c; }
    if (op.type !== 'status') return c;
    var h = item.status || (item.status = []);
    while (h.length && h[h.length - 1][0] >= op.date) h.pop();
    if (statusOn(item, op.date) !== op.status) h.push([op.date, op.status]);
    return c;
  }

  // ---- To-dos: todo.json = { "items": [{ id, text, on, t, done }] }. on = the day it's planned for (the day it
  // was added, or one picked: tomorrow, a day to come), t = when it was written; done = "YYYY-MM-DD HH:MM". On
  // screen it sits on its own day, so an open one slides left as the days pass; a done one stays until that day
  // ends. All of them stay in the file.

  function isTodoOp(op) { return /^todo(Add|Done|Edit|Del)$/.test(op.type); }

  function applyTodo(j, op) {
    j.items = j.items || [];
    var id = op.item ? op.item.id : op.id, i, k = -1;
    for (i = 0; i < j.items.length; i++) if (j.items[i].id === id) k = i;
    var it = k >= 0 ? j.items[k] : null;
    if (op.type === 'todoAdd') { if (!it) j.items.push(op.item); }
    else if (it && op.type === 'todoDone') { if (op.done) it.done = op.done; else delete it.done; }
    else if (it && op.type === 'todoEdit') { if (op.text) it.text = op.text; if (op.on) it.on = op.on; }
    else if (it && op.type === 'todoDel') j.items.splice(k, 1);
    return j;
  }

  function newTodo(text, date) {
    var now = new Date();
    return { type: 'todoAdd', item: { id: newId(), text: text, on: date || ymd(now), t: hhmm(now) } };
  }

  // What's on screen: the open ones and the ones done today, oldest plan first
  function todosShown(j, now) {
    var out = [], l = (j && j.items) || [];
    now = now || today();
    for (var i = 0; i < l.length; i++) if (!l[i].done || l[i].done.slice(0, 10) >= now) out.push(l[i]);
    return out.sort(function (a, b) { var x = a.on + (a.t || ''), y = b.on + (b.t || ''); return x < y ? -1 : x > y ? 1 : 0; });
  }

  function stamp(d) { d = d || new Date(); return ymd(d) + ' ' + hhmm(d); }

  // ---- Apple Health, from the phone's Shortcut: inbox/YYYY-MM-DD-HHMM.txt with lines like
  //   steps 8432                                   that day's steps so far
  //   sleep 2026-10-18 23:08 2026-10-19 02:07      a sleep interval (Mi Fitness gives In Bed times)
  // -> 'steps' and 'healthSleep' changes. A night belongs to the day it ends on (ending after 18:00: the next
  // day's night). Forgiving about the rest of the text: only the numbers and the times count.

  function stampOf(s) { var m = /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(s); return m ? m[1] + ' ' + pad(+m[2]) + ':' + m[3] : null; }
  function minutesOf(s) { return parse(s.slice(0, 10)).getTime() / 60000 + +s.slice(11, 13) * 60 + +s.slice(14, 16); }
  function joinSpans(list) {
    var l = list.slice().sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; }), out = [];
    for (var i = 0; i < l.length; i++) {
      var last = out[out.length - 1];
      if (last && l[i][0] <= last[1]) { if (l[i][1] > last[1]) last[1] = l[i][1]; } else out.push([l[i][0], l[i][1]]);
    }
    return out;
  }
  function spanMinutes(list) { var m = 0; for (var i = 0; i < list.length; i++) m += minutesOf(list[i][1]) - minutesOf(list[i][0]); return Math.round(m); }

  function healthOps(name, text) {
    var m = /(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(name), day = m ? m[1] : today(), at = m ? day + ' ' + m[2] + ':' + m[3] : stamp();
    var lines = String(text || '').split(/\r?\n/), ops = [], nights = {}, i, k;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i], times;
      if (/^\s*steps/i.test(l)) {
        var n = parseInt(l.replace(/\.\d+/, '').replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) ops.push({ type: 'steps', date: day, steps: { n: n, at: at } });
      } else if (/^\s*sleep/i.test(l) && (times = l.match(/\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/g)) && times.length >= 2) {
        var a = stampOf(times[0]), b = stampOf(times[1]);
        if (!(a < b)) continue;
        k = +b.slice(11, 13) >= 18 ? addDays(b.slice(0, 10), 1) : b.slice(0, 10);
        (nights[k] = nights[k] || []).push([a, b]);
      }
    }
    for (k in nights) if (nights.hasOwnProperty(k)) ops.push({ type: 'healthSleep', date: k, at: joinSpans(nights[k]) });
    return ops;
  }

  // ---- Files: readable JSON, days in order, short arrays and objects on one line

  function serialize(m) {
    var days = {}, keys = [];
    for (var k in m.days) if (m.days.hasOwnProperty(k)) keys.push(k);
    keys.sort();
    for (var i = 0; i < keys.length; i++) days[keys[i]] = m.days[keys[i]];
    var out = {};
    for (k in m) if (m.hasOwnProperty(k)) out[k] = k === 'days' ? days : m[k];
    return format(out, '') + '\n';
  }

  function serializeConfig(c) { return format(c, '') + '\n'; }
  function serializeTodo(j) { return format(j, '') + '\n'; }

  function format(v, ind) {
    var flat = JSON.stringify(v);
    if (v === null || typeof v !== 'object' || flat.length + ind.length <= 100) return flat;
    var inner = ind + ' ', parts = [];
    if (Object.prototype.toString.call(v) === '[object Array]') {
      for (var i = 0; i < v.length; i++) parts.push(inner + format(v[i], inner));
      return '[\n' + parts.join(',\n') + '\n' + ind + ']';
    }
    for (var k in v) if (v.hasOwnProperty(k)) parts.push(inner + JSON.stringify(k) + ': ' + format(v[k], inner));
    return '{\n' + parts.join(',\n') + '\n' + ind + '}';
  }

  // ---- Base64 of UTF-8 text (the GitHub API sends file contents this way)

  function toB64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function fromB64(b) { return decodeURIComponent(escape(atob(b.replace(/\s/g, '')))); }

  function newId() { return Math.random().toString(36).slice(2, 8); }

  return {
    WEEKDAYS: WEEKDAYS, pad: pad, ymd: ymd, parse: parse, addDays: addDays, diffDays: diffDays, today: today,
    hhmm: hhmm, weekday: weekday, monday: monday, monthOf: monthOf, weeks: weeks, span: span, statusOn: statusOn, find: find,
    dayOf: dayOf, entryOf: entryOf, isDone: isDone, windowOf: windowOf, cell: cell, weekCount: weekCount,
    hint: hint, rows: rows, suppOf: suppOf, suppRows: suppRows, isSet: isSet, apply: apply, dayText: dayText,
    dayNotes: dayNotes, isConfigOp: isConfigOp, newItem: newItem, moveOp: moveOp, applyConfig: applyConfig,
    isTodoOp: isTodoOp, applyTodo: applyTodo, newTodo: newTodo, todosShown: todosShown, stamp: stamp,
    serializeTodo: serializeTodo, healthOps: healthOps, joinSpans: joinSpans,
    serialize: serialize, serializeConfig: serializeConfig, toB64: toB64, fromB64: fromB64, newId: newId
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
