(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const DONE_KEY = 'ipadBatt.done.v1';
  const PREF_KEY = 'ipadBatt.pref.v1';
  const REFRESH_MS = 5 * 60 * 1000;
  const FLAG = {
    critical: { t: '電量危險', c: 'var(--crit)' },
    low: { t: '電量偏低', c: 'var(--low)' },
    night: { t: '半夜沒充飽', c: 'var(--night)' },
    persist: { t: '連續低電量', c: 'var(--crit)' },
    stale: { t: '很久沒回報', c: 'var(--stale)' },
  };
  const PROBLEM = ['critical', 'low', 'night', 'persist'];
  let data = null;
  let done = load(DONE_KEY, {});
  const pref = Object.assign({ showTeacher: false, hideDone: false }, load(PREF_KEY, {}));

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式 */ } }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function color(d) {
    if (d.flags.includes('stale')) return 'var(--stale)';
    if (d.battery == null) return 'var(--stale)';
    if (d.battery < data.thresholds.critical) return 'var(--crit)';
    if (d.battery < data.thresholds.low) return 'var(--low)';
    return 'var(--ok)';
  }
  function ago(iso) {
    if (!iso) return '從未回報';
    const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return '剛剛';
    if (m < 60) return `${Math.round(m)} 分鐘前`;
    if (m < 60 * 24) return `${Math.round(m / 60)} 小時前`;
    const d = Math.round(m / 1440);
    return d < 60 ? `${d} 天前` : `${Math.round(d / 30)} 個月前`;
  }
  function when(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const where = (d) => d.kind === 'other' ? d.name : `${d.cartLabel}${d.slot != null ? ` ${String(d.slot).padStart(2, '0')} 號` : ''}`;
  const doneKey = (d) => `${d.id}@${d.reportedAt}`;
  const isDone = (d) => !!done[doneKey(d)];
  const batt = (d) => `<span class="batt" style="--c:${color(d)};--p:${d.battery ?? 0}"><span>${d.battery ?? '?'}%</span></span>`;
  const tags = (d) => d.flags.filter((f) => FLAG[f]).map((f) => `<span class="tag" style="--t:${FLAG[f].c}">${FLAG[f].t}</span>`).join('');

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  async function fetchData() {
    const st = $('#status');
    try {
      const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
      // 清掉已經不存在的打勾紀錄（平板回報新電量後，舊的勾自動失效）
      const valid = new Set(data.devices.map(doneKey));
      done = Object.fromEntries(Object.entries(done).filter(([k]) => valid.has(k)));
      save(DONE_KEY, done);
      render();
    } catch (e) {
      st.className = 'status error';
      $('#statusText').textContent = '讀取資料失敗，稍後會自動再試';
    }
  }

  // 學校名稱與門檻數字來自 config.json（由 fetch_jamf.py 寫進 data.json）
  function applyConfig() {
    const sc = data.school || {}, th = data.thresholds;
    document.querySelectorAll('[data-school]').forEach((el) => { if (sc[el.dataset.school]) el.textContent = sc[el.dataset.school]; });
    if (sc.shortName) document.title = `iPad 電量監控站｜${sc.shortName}${sc.team || ''}`;
    const hm = (s) => (s ? s.replace(/^0(\d):/, '$1:') : s);
    const v = { low: th.low, critical: th.critical, lowMinus1: th.low - 1, nightFull: th.nightFull,
      staleDays: Math.round(th.staleHours / 24), nightStart: hm(th.nightStart), nightEnd: hm(th.nightEnd) };
    document.querySelectorAll('[data-t]').forEach((el) => { if (v[el.dataset.t] != null) el.textContent = v[el.dataset.t]; });
  }

  function renderStatus() {
    const age = (Date.now() - Date.parse(data.generatedAt)) / 60000;
    $('#status').className = 'status ' + (age < 45 ? 'fresh' : 'old');
    $('#statusText').textContent = `資料更新於 ${when(data.generatedAt)}（${ago(data.generatedAt)}）${data.inventoryCommandAt ? `・${ago(data.inventoryCommandAt)}已請平板回報` : ''}${age >= 45 ? '・自動更新可能延遲' : ''}`;
  }

  function todoItems() {
    return data.devices
      .filter((d) => (d.kind === 'student' || (pref.showTeacher && d.kind === 'teacher')))
      .filter((d) => !d.flags.includes('stale') && d.flags.some((f) => PROBLEM.includes(f)))
      .sort((a, b) => (isDone(a) - isDone(b)) || ((b.flags.includes('critical') || b.flags.includes('persist')) - (a.flags.includes('critical') || a.flags.includes('persist'))) || (a.battery - b.battery));
  }

  function renderTiles() {
    const s = data.summary, th = data.thresholds;
    const lowAll = data.devices.filter((d) => d.battery != null && d.battery < data.thresholds.low && !d.flags.includes('stale')).length;
    const tiles = [
      { n: s.needCheck, l: '學生機要檢查', sub: '充電車上電量有狀況', c: 'var(--brand)', go: '#todo' },
      { n: data.devices.filter((d) => d.kind === 'student' && d.flags.includes('critical') && !d.flags.includes('stale')).length, l: `學生機低於 ${th.critical}%`, sub: '最優先處理', c: 'var(--crit)', go: '#todo' },
      { n: data.devices.filter((d) => d.flags.includes('night')).length, l: '半夜沒充飽', sub: `${nightRange()} 回報不到 ${th.nightFull}%`, c: 'var(--night)', go: '#todo' },
      { n: lowAll, l: `全校低於 ${th.low}%`, sub: `含老師機・共 ${s.total} 台`, c: 'var(--low)', go: '#carts' },
      { n: s.stale, l: `${staleDays()} 天以上沒回報`, sub: '電量資料已過期', c: 'var(--stale)', go: '#staleList' },
    ];
    $('#tiles').innerHTML = tiles.map((t, i) => `<button class="tile" data-go="${t.go}" style="--c:${t.c}"><div class="num">${t.n}</div><div class="lbl">${t.l}</div><small>${t.sub}</small></button>`).join('');
    $('#tiles').querySelectorAll('.tile').forEach((b) => b.addEventListener('click', () => document.querySelector(b.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' })));
  }

  const staleDays = () => Math.round(data.thresholds.staleHours / 24);
  const nightRange = () => `${(data.thresholds.nightStart || '00:00').replace(/^0(\d):/, '$1:')}–${(data.thresholds.nightEnd || '07:30').replace(/^0(\d):/, '$1:')}`;

  function renderTodo() {
    let items = todoItems();
    if (pref.hideDone) items = items.filter((d) => !isDone(d));
    $('#todoList').innerHTML = items.length ? items.map((d) => `
      <div class="todo ${isDone(d) ? 'done' : ''}" style="--c:${color(d)}">
        ${batt(d)}
        <button class="open" data-id="${d.id}" type="button">
          <div class="where">${esc(where(d))}</div>
          <div class="meta">${esc(d.name)}・${ago(d.reportedAt)}回報${d.trend != null && d.trend !== 0 ? `・比上次${d.trend > 0 ? '多' : '少'} ${Math.abs(d.trend)}%` : ''}</div>
          <div class="tags">${tags(d)}</div>
        </button>
        <label class="done-box"><input type="checkbox" data-done="${d.id}" ${isDone(d) ? 'checked' : ''}>已檢查</label>
      </div>`).join('') : '<div class="empty">🎉 目前沒有需要檢查的平板，充電車都很正常！</div>';
  }

  function renderCarts() {
    const groups = new Map();
    for (const d of data.devices) {
      const k = d.cartLabel; if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(d);
    }
    const order = data.carts || [];  // 依 config.json 的車子順序排
    const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
    $('#carts').innerHTML = keys.map((k) => {
      const list = groups.get(k).sort((a, b) => (a.slot ?? 999) - (b.slot ?? 999) || a.name.localeCompare(b.name));
      const bad = list.filter((d) => !d.flags.includes('stale') && d.flags.some((f) => PROBLEM.includes(f))).length;
      const stale = list.filter((d) => d.flags.includes('stale')).length;
      return `<div class="cart"><div class="cart-head"><h3>${esc(k)}</h3>
        <span class="sum">${list.length} 台${bad ? `・<b>${bad} 台要注意</b>` : '・正常'}${stale ? `・${stale} 台沒回報` : ''}</span></div>
        <div class="slots">${list.map((d) => `<button class="slot ${d.flags.includes('stale') ? 'stale' : ''} ${!d.flags.includes('stale') && d.flags.some((f) => PROBLEM.includes(f)) ? 'flag' : ''}"
          style="--c:${color(d)};--p:${d.battery ?? 0};--o:${d.flags.includes('night') || d.flags.includes('persist') ? 'var(--night)' : color(d)}" data-id="${d.id}" type="button" title="${esc(d.name)}：${d.battery ?? '?'}%（${ago(d.reportedAt)}回報）">
          <span class="n">${d.slot != null ? String(d.slot).padStart(2, '0') : '—'}</span><span class="v">${d.battery ?? '?'}</span></button>`).join('')}</div></div>`;
    }).join('');
  }

  function renderStale() {
    const list = data.devices.filter((d) => d.flags.includes('stale')).sort((a, b) => Date.parse(a.reportedAt || 0) - Date.parse(b.reportedAt || 0));
    $('#staleList').innerHTML = list.length ? list.map((d) => `<button class="stale-item" data-id="${d.id}" type="button">${esc(where(d))}<small>${d.battery ?? '?'}%・${ago(d.reportedAt)}</small></button>`).join('')
      : `<div class="empty">全部平板 ${staleDays()} 天內都有回報 👍</div>`;
  }

  function chart(hist) {
    if (!hist || hist.length < 2) return '<p class="chart-cap">電量紀錄還不夠多，監控站會從今天開始累積（保留 14 天）。</p>';
    const W = 560, H = 180, P = 28;
    const t0 = Date.parse(hist[0][0]), t1 = Date.parse(hist[hist.length - 1][0]);
    const x = (t) => P + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - P * 2);
    const y = (v) => H - P - (v / 100) * (H - P * 2);
    const pts = hist.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="電量變化圖">
      <line x1="${P}" x2="${W - P}" y1="${y(data.thresholds.low)}" y2="${y(data.thresholds.low)}" stroke="#e8890c" stroke-dasharray="4 4"/>
      <text x="${P}" y="${y(data.thresholds.low) - 4}" font-size="11" fill="#e8890c">${data.thresholds.low}%</text>
      <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" stroke="#ddd"/>
      <line x1="${P}" x2="${W - P}" y1="${y(100)}" y2="${y(100)}" stroke="#eee"/>
      <polyline points="${pts}" fill="none" stroke="#1f6f5c" stroke-width="2.5" stroke-linejoin="round"/>
      ${hist.map(([t, v]) => `<circle cx="${x(t)}" cy="${y(v)}" r="3.5" fill="#1f6f5c"><title>${when(t)}：${v}%</title></circle>`).join('')}
      <text x="${P}" y="${H - 6}" font-size="11" fill="#777">${when(hist[0][0])}</text>
      <text x="${W - P}" y="${H - 6}" font-size="11" fill="#777" text-anchor="end">${when(hist[hist.length - 1][0])}</text>
    </svg><p class="chart-cap">每個點是平板回報給 Jamf 的電量（最近 14 天）。</p>`;
  }

  function advice(d) {
    if (d.flags.includes('stale')) return `這台超過 ${staleDays()} 天沒回報，電量是舊資料。請找到平板，接上充電線開機並連上 Wi-Fi，回報後就會更新。`;
    if (d.flags.includes('night')) return '這台半夜在充電車上卻沒充飽，最可能是：充電線沒插緊、充電線或接頭壞了、或那一格的插座沒電。可以換一條線試試看。';
    if (d.flags.includes('persist')) return `連續兩次回報都低於 ${data.thresholds.low}% 而且沒有回升，表示它沒有在充電。請檢查充電線是否插好、線材是否損壞。`;
    if (d.flags.includes('critical')) return '電量非常低，下一堂課可能撐不住。如果它現在在充電車上，請確認充電線有插好（螢幕應該會出現充電閃電符號）。';
    if (d.flags.includes('low')) return '電量偏低。如果剛下課才放回車上是正常的；若放回車上好幾個小時還是偏低，就要檢查充電線。';
    return '電量正常 👍';
  }

  function openDetail(id) {
    const d = data.devices.find((x) => x.id === id); if (!d) return;
    $('#detailBody').innerHTML = `
      <h3>${esc(where(d))}</h3>
      <div class="tags" style="margin-top:6px">${tags(d) || '<span class="tag" style="--t:var(--ok)">正常</span>'}</div>
      <dl>
        <dt>目前電量</dt><dd>${batt(d)}</dd>
        <dt>裝置名稱</dt><dd>${esc(d.name)}</dd>
        <dt>Jamf 使用者</dt><dd>${esc(d.user || '—')}</dd>
        <dt>機型</dt><dd>${esc(d.model)}</dd>
        <dt>電量回報時間</dt><dd>${when(d.reportedAt)}（${ago(d.reportedAt)}）</dd>
        <dt>最後連線時間</dt><dd>${when(d.contactAt)}（${ago(d.contactAt)}）</dd>
      </dl>
      <div class="advice">💡 ${advice(d)}</div>
      ${chart(d.history)}`;
    $('#detail').showModal();
  }

  function render() {
    applyConfig(); renderStatus(); renderTiles(); renderTodo(); renderCarts(); renderStale();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-id]');
    if (t && !e.target.closest('[data-done]')) openDetail(t.dataset.id);
  });
  document.addEventListener('change', (e) => {
    const id = e.target.dataset?.done; if (!id) return;
    const d = data.devices.find((x) => x.id === id);
    if (e.target.checked) done[doneKey(d)] = Date.now(); else delete done[doneKey(d)];
    save(DONE_KEY, done); renderTodo();
  });
  $('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#showTeacher').checked = pref.showTeacher;
  $('#hideDone').checked = pref.hideDone;
  $('#showTeacher').addEventListener('change', (e) => { pref.showTeacher = e.target.checked; save(PREF_KEY, pref); renderTodo(); });
  $('#hideDone').addEventListener('change', (e) => { pref.hideDone = e.target.checked; save(PREF_KEY, pref); renderTodo(); });
  $('#reload').addEventListener('click', () => { fetchData().then(() => data && toast('已重新讀取最新資料')); });
  $('#copyList').addEventListener('click', async () => {
    const items = todoItems().filter((d) => !isDone(d));
    const text = items.length ? [`iPad 電量待檢查（${when(data.generatedAt)}）`, ...items.map((d) => `・${where(d)}：${d.battery}%（${d.flags.filter((f) => FLAG[f]).map((f) => FLAG[f].t).join('、')}）`)].join('\n') : '目前沒有需要檢查的平板';
    try { await navigator.clipboard.writeText(text); toast(`已複製 ${items.length} 台的清單，可以貼到 LINE`); } catch { toast('複製失敗，請手動選取'); }
  });

  fetchData();
  setInterval(fetchData, REFRESH_MS);
  setInterval(() => data && renderStatus(), 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchData(); });
})();
