// Launch Radar's page: filter, sort, re-rank and inspect the board.
// All data comes from window.RADAR (data.js beside the page); nothing is fetched.
(function () {
  'use strict';
  var R = window.RADAR;
  var M = R.model;

  var state = {
    q: '', category: '', chain: '', watch: false, minTvl: 0,
    sortKey: 'rank', sortDir: 1, selected: null,
    growth: M.growth_weight, matDays: M.maturity_days, cap: M.multiple_cap,
  };

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function days(n) { return n === null || n === undefined ? '—' : n + 'd'; }
  function mult(n) { return '×' + n.toFixed(2); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Recompute implied values under the sandbox constants; returns fresh ranked rows. */
  function recompute() {
    var rows = R.rows.map(function (r) {
      var multiple = Math.min(state.cap, Math.max(M.multiple_floor, r.multiple_raw));
      var growthPct = Math.min(M.growth_cap, Math.max(M.growth_floor, r.change_7d === null ? 0 : r.change_7d));
      var growthMult = 1 + (growthPct / 100) * state.growth;
      var age = r.age_days === null ? M.unknown_age_days : r.age_days;
      var maturityMult = M.maturity_floor + (Math.min(Math.max(age, 0), state.matDays) / state.matDays) * M.maturity_range;
      var breadthMult = 1 + Math.min(Math.max(r.chains.length - 1, 0), M.breadth_max_chains) * M.breadth_step;
      var implied = Math.max(1, Math.round(r.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
      return {
        slug: r.slug, name: r.name, category: r.category, chains: r.chains,
        tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at,
        age_days: r.age_days, on_watchlist: r.on_watchlist, farm_steps: r.farm_steps,
        multiple: multiple, multiple_raw: r.multiple_raw, multiple_source: r.multiple_source,
        comparables: r.comparables, growth_multiplier: growthMult,
        maturity_multiplier: maturityMult, breadth_multiplier: breadthMult,
        implied_value_usd: implied,
      };
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  function farmCost(row) {
    var step = row.farm_steps[1] || '';
    var parts = step.split(' Cost: ');
    if (parts.length < 2) return '—';
    var cost = parts[1].split(' Time: ')[0] || '';
    return cost.replace(/\.$/, '') || '—';
  }

  function visible(rows) {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !r.on_watchlist) return false;
      if (r.tvl_usd < state.minTvl) return false;
      return true;
    });
  }

  function sorted(rows) {
    var k = state.sortKey, d = state.sortDir;
    var val = function (r) {
      if (k === 'name' || k === 'category') return (r[k] || '').toLowerCase();
      if (k === 'chains') return r.chains.length;
      if (k === 'farm') return r.tvl_usd;
      var v = r[k];
      return v === null || v === undefined ? -Infinity : v;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -d;
      if (va > vb) return d;
      return a.rank - b.rank;
    });
  }

  function renderBoard(rows) {
    var list = sorted(visible(rows));
    $('count').textContent = list.length + ' of ' + rows.length + ' rows';
    var html = list.map(function (r) {
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + days(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + mult(r.multiple) + '</td>' +
        '<td>' + esc(farmCost(r)) + '</td></tr>';
    }).join('');
    $('rows').innerHTML = html || '<tr><td colspan="10">No protocols match these filters.</td></tr>';
    var trs = $('rows').querySelectorAll('tr[data-slug]');
    trs.forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug'), rows, true); });
    });
    document.querySelectorAll('#board th').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-k') === state.sortKey);
    });
  }

  function renderDetail(rows) {
    var el = $('detail');
    var r = rows.filter(function (x) { return x.slug === state.selected; })[0];
    if (!r) {
      el.innerHTML = '<p class="hint">Select a row to see its model breakdown and farm plan.</p>';
      return;
    }
    var src = r.multiple_source === 'category'
      ? 'category median over ' + r.comparables + ' live comparables'
      : 'global median, fewer than three live comparables in this category';
    var steps = r.farm_steps.map(function (s) {
      var parts = s.split(' Cost: ');
      var rest = (parts[1] || '').split(' Time: ');
      return '<li>' + esc(parts[0]) + '<br><span class="cost">Cost: ' + esc(rest[0] || '') +
        '</span> · <span class="time">Time: ' + esc((rest[1] || '').replace(/\.$/, '')) + '</span></li>';
    }).join('');
    el.innerHTML =
      '<h3>' + esc(r.name) + ' <span class="slug">' + esc(r.slug) + '</span>' +
      (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h3>' +
      '<div class="facts"><span>Category <b>' + esc(r.category || '—') + '</b></span>' +
      '<span>Chains <b>' + esc(r.chains.join(', ') || '—') + '</b></span>' +
      '<span>TVL <b>' + money(r.tvl_usd) + '</b></span>' +
      '<span>7d <b>' + pct(r.change_7d) + '</b></span>' +
      '<span>Listed <b>' + esc(r.listed_at || '—') + '</b></span>' +
      '<span>Age <b>' + days(r.age_days) + '</b></span>' +
      '<span>Token <b>none recorded</b></span></div>' +
      '<div class="formula">implied = ' + money(r.tvl_usd) + ' × ' + mult(r.multiple) + ' (' + esc(src) + ')' +
      ' × ' + r.growth_multiplier.toFixed(3) + ' growth × ' + r.maturity_multiplier.toFixed(3) +
      ' maturity × ' + r.breadth_multiplier.toFixed(3) + ' breadth = <b>' + money(r.implied_value_usd) + '</b></div>' +
      '<h2 style="margin-top:14px">Farm plan</h2><ol>' + steps + '</ol>';
  }

  function select(slug, rows, scroll) {
    state.selected = slug;
    renderBoard(rows);
    renderDetail(rows);
    if (scroll) $('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function renderStatic() {
    $('meta').textContent = 'Snapshot ' + R.as_of + ' · model ' + R.model_version + ' · ' +
      R.board_size + ' protocols ranked (' + R.watchlist_size + ' watchlist, ' + R.early_size +
      ' below the floor) · ' + R.excluded_size + ' set aside · global multiple ' + mult(R.global_multiple);
    $('source').textContent = 'Source: ' + R.source + '. Floor: ' + money(R.floor_usd) + ' TVL.';
    $('multrows').innerHTML = R.multiples.map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num">' + mult(m.multiple) +
        '</td><td class="num">' + m.comparables + '</td></tr>';
    }).join('');
    $('liverows').innerHTML = R.live.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) +
        '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + mult(p.multiple) + '</td></tr>';
    }).join('');
    $('excrows').innerHTML = R.excluded.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) +
        '</td><td>' + esc(p.reason) + '</td></tr>';
    }).join('');
    var cats = {}, chains = {};
    R.rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
    });
  }

  function renderAll() {
    var rows = recompute();
    renderBoard(rows);
    renderDetail(rows);
    return rows;
  }

  function syncSandboxLabels() {
    $('sb-growth-v').textContent = state.growth.toFixed(2);
    $('sb-mat-v').textContent = state.matDays + 'd';
    $('sb-cap-v').textContent = '×' + state.cap.toFixed(1);
  }

  // Wire the controls.
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderAll(); });
  $('cat').addEventListener('change', function (e) { state.category = e.target.value; renderAll(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderAll(); });
  $('mintvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderAll(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderAll(); });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = (k === 'name' || k === 'category' || k === 'rank') ? 1 : -1; }
      renderAll();
    });
  });
  $('sb-growth').value = state.growth;
  $('sb-mat').value = state.matDays;
  $('sb-cap').value = state.cap;
  $('sb-growth').addEventListener('input', function (e) { state.growth = Number(e.target.value); syncSandboxLabels(); renderAll(); });
  $('sb-mat').addEventListener('input', function (e) { state.matDays = Number(e.target.value); syncSandboxLabels(); renderAll(); });
  $('sb-cap').addEventListener('input', function (e) { state.cap = Number(e.target.value); syncSandboxLabels(); renderAll(); });
  $('sb-reset').addEventListener('click', function () {
    state.growth = M.growth_weight; state.matDays = M.maturity_days; state.cap = M.multiple_cap;
    $('sb-growth').value = state.growth; $('sb-mat').value = state.matDays; $('sb-cap').value = state.cap;
    syncSandboxLabels(); renderAll();
  });

  renderStatic();
  syncSandboxLabels();
  var rows = renderAll();

  // Staging for screenshots: ?shot=board|detail|filtered
  var shot = new URLSearchParams(location.search).get('shot');
  if (shot === 'detail' && rows.length > 0) {
    state.selected = rows[0].slug;
    renderBoard(rows); renderDetail(rows);
  } else if (shot === 'filtered') {
    state.category = 'Lending'; $('cat').value = 'Lending';
    renderBoard(rows); renderDetail(rows);
  }

  window.__radar = { state: state, rows: rows };
  window.__radarReady = true;
})();
