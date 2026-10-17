// The rules: what each square shows, and how a change is written into a month file.
// Shared by the web app and the laptop desk widget (desk\daily_widget.ahk runs this file in
// Windows' built-in IE11 script engine), so ES5 only: var and function, no arrows, let,
// classes or template strings.

var Core = (function () {
  var WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // ---- Dates: 'YYYY-MM-DD' strings in local time

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

  // ---- Lifecycle: item.status = [["2026-10-17", "active"], ["2026-12-01", "paused"], ...]
  // Before the first date the item didn't exist yet.

  function statusOn(item, date) {
    var s = null, h = item.status || [];
    for (var i = 0; i < h.length; i++) if (h[i][0] <= date) s = h[i][1];
    return s;
  }

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
  function windowOf(task, date) {
    if (task.kind === 'weekly') return WEEKDAYS[weekday(date)] === task.day ? [date, date] : null;
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

  // What one square shows:
  //   done    green
  //   todo    today, still open
  //   missed  grey with a small dot
  //   open    due or possible that day, nothing to show (faint square, tappable)
  //   none    not due that day (no square)
  //   off     paused, retired or not started yet
  function cell(task, data, date, now) {
    now = now || today();
    if (statusOn(task, date) !== 'active') return 'off';
    var w = windowOf(task, date);
    if (!w) return 'none';
    if (isDone(task, data, date)) return 'done';
    if (date > now) return 'open';
    if (task.kind === 'gym' || task.must === false) return date === now ? 'todo' : 'open';
    if (w[0] !== w[1]) {
      // A window of several days (24h fast, month end): done once anywhere in it is enough.
      if (doneBetween(task, data, w[0], w[1] < now ? w[1] : now)) return 'open';
      if (date === now) return 'todo';
      return date === w[1] ? 'missed' : 'open';
    }
    return date === now ? 'todo' : 'missed';
  }

  function weekCount(task, data, date) {
    var m = monday(date), n = 0;
    for (var i = 0; i < 7; i++) if (isDone(task, data, addDays(m, i))) n++;
    return n;
  }

  // A few words beside the name: "2/3" (gym this week), "5 days left" (fast, month end).
  function hint(task, data, now) {
    now = now || today();
    if (statusOn(task, now) !== 'active') return '';
    if (task.kind === 'gym') return weekCount(task, data, now) + '/' + task.perWeek;
    if (task.kind === 'every' || task.kind === 'monthEnd') {
      var w = windowOf(task, now);
      if (!w) return '';
      if (doneBetween(task, data, w[0], now)) return 'done';
      var left = diffDays(now, w[1]) + 1;
      return left === 1 ? 'last day' : left + ' days left';
    }
    return '';
  }

  // Everything a grid needs: one row per active-ish task, one cell per date.
  function rows(config, data, dates, now) {
    now = now || today();
    var out = [];
    var tasks = config.tasks || [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], cells = [], shown = false;
      for (var j = 0; j < dates.length; j++) {
        var st = cell(t, data, dates[j], now), e = entryOf(t, data, dates[j]);
        if (st !== 'off') shown = true;
        cells.push({ date: dates[j], state: st, note: (e && e.note) || '' });
      }
      if (!shown) continue;
      out.push({ id: t.id, name: t.name, kind: t.kind, optional: t.must === false, hint: hint(t, data, now), cells: cells });
    }
    return out;
  }

  // ---- Changes to a month file ({ "days": { "2026-10-17": {...} } })
  // Every op can be applied twice safely: after a sync conflict it's applied again to the newer file.

  function apply(m, op) {
    m.days = m.days || {};
    var d = m.days[op.date] || (m.days[op.date] = {});
    var i, t;
    if (op.type === 'task') {
      d.tasks = d.tasks || {};
      t = d.tasks[op.id] || (d.tasks[op.id] = {});
      if (op.done) t.done = true; else delete t.done;
    } else if (op.type === 'note') {
      d.tasks = d.tasks || {};
      t = d.tasks[op.id] || (d.tasks[op.id] = {});
      if (op.text) t.note = op.text; else delete t.note;
    } else if (op.type === 'log') {
      d.log = d.log || [];
      for (i = 0; i < d.log.length && d.log[i].id !== op.entry.id; i++);
      d.log[i] = op.entry;
      d.log.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    } else if (op.type === 'unlog') {
      d.log = (d.log || []).filter(function (e) { return e.id !== op.id; });
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
    var d = m.days[date];
    if (d.tasks) {
      for (var k in d.tasks) if (d.tasks.hasOwnProperty(k) && isEmpty(d.tasks[k])) delete d.tasks[k];
      if (isEmpty(d.tasks)) delete d.tasks;
    }
    if (d.log && !d.log.length) delete d.log;
    if (isEmpty(d)) delete m.days[date];
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
    hhmm: hhmm, weekday: weekday, monday: monday, monthOf: monthOf, statusOn: statusOn, dayOf: dayOf,
    entryOf: entryOf, isDone: isDone, windowOf: windowOf, cell: cell, weekCount: weekCount, hint: hint,
    rows: rows, apply: apply, serialize: serialize, toB64: toB64, fromB64: fromB64, newId: newId
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
