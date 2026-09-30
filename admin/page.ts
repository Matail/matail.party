// 관리자 페이지 (한 장짜리 HTML). 게임 모듈이 돌려주는 블록을 그대로 그린다 — 게임을 몰라도 된다 (games/types.ts).
// 탭: 통계(필터 · PDF 리포트 · 요약 JSON) / 내보내기(CSV · JSON) / 설정(수집 · 공개 카드 · 테스트 기록 정리)
export const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>my-site 관리자</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  :root { --bg:#0a0a0f; --card:#111116; --panel:#16161c; --line:rgba(255,255,255,.07); --ink:#edebe6; --ink-2:#a7a5ae; --ink-3:#7c7a84;
          --teal:#22ab9b; --warn:#e66767; --track:rgba(255,255,255,.05); }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 28px 16px 64px; }
  header { display: flex; justify-content: space-between; align-items: end; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  h1 { font-size: 1.5rem; margin: 0; }
  .meta { color: var(--ink-3); font-size: .85rem; }
  .err { color: #f2a9a9; }
  .ok { color: #7ee0d3; }
  button, .btn, select, input[type=date] {
    font: inherit; font-size: .85rem; color: var(--ink); background: var(--panel); border: 1px solid var(--line);
    border-radius: 9px; padding: 6px 12px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  }
  input[type=date] { color-scheme: dark; cursor: text; }
  button:hover, .btn:hover { border-color: rgba(255,255,255,.2); }
  button.primary { background: var(--teal); color: #04120f; border-color: transparent; font-weight: 600; }
  button.danger { background: rgba(230,103,103,.16); color: #f2a9a9; border-color: rgba(230,103,103,.35); }
  button:disabled { opacity: .5; cursor: default; }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .tabs button[aria-selected=true] { background: rgba(34,171,155,.16); border-color: rgba(34,171,155,.5); color: #7ee0d3; }
  .tabs.views button { background: none; border-color: transparent; }
  .tabs.views button[aria-selected=true] { background: var(--panel); border-color: var(--line); color: var(--ink); }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px; margin-bottom: 16px;
             background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  .filters label { font-size: .78rem; color: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; }
  .filters .grow { flex: 1; }
  .toolbar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 12px; flex-wrap: wrap; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; grid-column: 1 / -1; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
  .tile span { display: block; font-size: .78rem; color: var(--ink-2); }
  .tile b { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
  .tile small { display: block; color: var(--ink-3); font-size: .75rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  section.card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 16px; break-inside: avoid; }
  section.card.wide { grid-column: 1 / -1; }
  h2 { font-size: .95rem; margin: 0 0 4px; }
  .note { color: var(--ink-3); font-size: .8rem; margin: 0 0 12px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--ink-3); font-weight: 500; }
  td.n, th.n { text-align: right; }
  .row { display: grid; grid-template-columns: 7.5rem 1fr 6rem; gap: 10px; align-items: center; font-size: .82rem; margin: 7px 0; }
  .track { height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 5px; background: var(--teal); }
  .fill.warn { background: var(--warn); }
  .num { text-align: right; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .list { display: grid; gap: 10px; }
  .item { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
          background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .item b { display: block; margin-bottom: 2px; }
  .item .note { margin: 0; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px 16px; margin: 10px 0; font-size: .88rem; }
  .opts label, .switch { display: flex; gap: 8px; align-items: center; cursor: pointer; }
  input[type=checkbox] { accent-color: var(--teal); width: 16px; height: 16px; }
  .counts { display: flex; gap: 16px; margin: 10px 0; font-size: .9rem; }
  .counts b { font-variant-numeric: tabular-nums; }
  .empty { color: var(--ink-3); font-size: .85rem; }
  [hidden] { display: none !important; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .row { grid-template-columns: 6rem 1fr 5rem; } }

  /* PDF 리포트: 흰 종이 */
  /* 화면 밖 틀 안에 둔다 — 리포트 자체를 화면 밖으로 옮기면 html2canvas 가 빈 종이를 찍는다 */
  .offscreen { position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: hidden; }
  .report { width: 780px; padding: 24px; background: #fff; color: #1b1b1f;
            --card:#fff; --panel:#f4f4f6; --line:#e3e3e8; --ink:#1b1b1f; --ink-2:#4a4a52; --ink-3:#6b6b74; --track:#ececf0; }
  .report h1 { font-size: 1.3rem; margin-bottom: 4px; }
  .report .grid { grid-template-columns: 1fr 1fr; }
  .report .tiles { grid-template-columns: repeat(5, 1fr); }
</style>
</head>
<body>
<main>
  <header>
    <div><h1>관리자</h1><div class="meta" id="meta">불러오는 중…</div></div>
  </header>
  <nav class="tabs" id="games" aria-label="게임"></nav>
  <nav class="tabs views" id="views" aria-label="보기">
    <button data-view="stats" aria-selected="true">통계</button>
    <button data-view="export">내보내기</button>
    <button data-view="settings">설정</button>
  </nav>

  <div class="filters" id="filters">
    <label>기간 <select id="period">
      <option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option>
      <option value="all" selected>전체</option><option value="custom">직접 지정</option>
    </select></label>
    <span id="custom" hidden><input type="date" id="from"> ~ <input type="date" id="to"></span>
    <label>난이도 <select id="level"></select></label>
    <label>클라이언트 <select id="client"></select></label>
    <span class="grow"></span>
    <button id="apply">새로고침</button>
  </div>

  <div id="v-stats">
    <div class="toolbar">
      <button id="pdf">PDF 리포트</button>
      <button id="summary">요약 JSON</button>
    </div>
    <div class="grid" id="blocks"></div>
  </div>

  <div id="v-export" hidden>
    <p class="note">위 조건(기간 · 난이도 · 클라이언트)으로 받아요. 한 번에 최대 10만 줄. CSV 는 엑셀에서 바로 열려요.</p>
    <div class="list" id="datasets"></div>
  </div>

  <div id="v-settings" hidden>
    <div class="list" id="settings"></div>
    <div class="list" id="cleanup" style="margin-top:16px"></div>
  </div>
</main>
<script>
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = n => Number(n || 0).toLocaleString('ko-KR');
const kstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const ACT = { 'x-admin-action': '1', 'content-type': 'application/json' };

let games = [], game = null, view = 'stats', last = null, viewer = '';

async function api(path, init) {
  const r = await fetch(path, { cache: 'no-store', ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.status);
  return body;
}

// ── 조건 ──
function query() {
  const p = new URLSearchParams(), period = $('period').value;
  if (period === 'custom') {
    if ($('from').value) p.set('from', $('from').value);
    if ($('to').value) p.set('to', $('to').value);
  } else if (period !== 'all') {
    p.set('from', kstDay(Date.now() - (Number(period) - 1) * 86400e3));
  }
  if ($('level').value) p.set('level', $('level').value);
  if ($('client').value) p.set('client', $('client').value);
  return p;
}
function describe() {
  const p = query(), parts = [];
  parts.push(p.get('from') || p.get('to') ? (p.get('from') || '처음') + ' ~ ' + (p.get('to') || '오늘') : '전체 기간');
  parts.push(p.get('level') ? game.levels[p.get('level') - 1] : '모든 난이도');
  parts.push(p.get('client') || '모든 클라이언트 (에디터 제외)');
  return parts.join(' · ');
}

// ── 블록 그리기 (화면과 PDF 가 같이 쓴다) ──
function renderBlocks(blocks) {
  return blocks.map(b => {
    if (b.kind === 'tiles') return '<div class="tiles">' + b.items.map(t =>
      '<div class="tile"><span>' + esc(t.label) + '</span><b>' + esc(t.value) + '</b>' + (t.sub ? '<small>' + esc(t.sub) + '</small>' : '') + '</div>').join('') + '</div>';
    const head = '<h2>' + esc(b.title) + '</h2>' + (b.note ? '<p class="note">' + esc(b.note) + '</p>' : '');
    let body = '';
    if (b.kind === 'bars') {
      const max = Math.max(1, b.max ?? Math.max(0, ...b.rows.map(r => r.value)));
      body = b.rows.length ? b.rows.map(r => '<div class="row"><span>' + esc(r.label) + '</span><span class="track"><span class="fill' + (r.warn ? ' warn' : '') +
        '" style="width:' + Math.round(r.value / max * 100) + '%"></span></span><span class="num">' + esc(r.text) + '</span></div>').join('')
        : '<p class="empty">아직 기록이 없어요</p>';
    } else if (b.kind === 'table') {
      body = b.rows.length ? '<table><tr>' + b.columns.map(c => '<th' + (c.num ? ' class="n"' : '') + '>' + esc(c.label) + '</th>').join('') + '</tr>' +
        b.rows.map(r => '<tr>' + r.map((v, i) => '<td' + (b.columns[i]?.num ? ' class="n"' : '') + '>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</table>'
        : '<p class="empty">아직 기록이 없어요</p>';
    }
    return '<section class="card' + (b.wide ? ' wide' : '') + '">' + head + body + '</section>';
  }).join('');
}

// ── 통계 ──
async function loadStats() {
  $('meta').textContent = '불러오는 중…';
  try {
    last = await api('/api/g/' + game.id + '/overview?' + query());
  } catch (e) { $('meta').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; return; }
  $('meta').textContent = viewer + ' · ' + new Date(last.generatedAt).toLocaleString('ko-KR');
  const keep = $('client').value;
  $('client').innerHTML = '<option value="">전체 (에디터 제외)</option>' + last.clients.map(c => '<option>' + esc(c) + '</option>').join('');
  $('client').value = last.clients.includes(keep) ? keep : '';
  $('blocks').innerHTML = renderBlocks(last.blocks);
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => kstDay(Date.now());

$('summary').onclick = () => {
  if (!last) return;
  const data = { game: game.id, title: game.title, condition: describe(), ...last };
  download(game.id + '-summary-' + stamp() + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
};

let pdfLib = null;
function loadPdfLib() {
  pdfLib ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload = () => ok(window.html2pdf);
    s.onerror = () => { pdfLib = null; fail(new Error('PDF 도구를 받지 못했어요')); };
    document.head.appendChild(s);
  });
  return pdfLib;
}
$('pdf').onclick = async () => {
  if (!last) return;
  const btn = $('pdf');
  btn.disabled = true; btn.textContent = 'PDF 만드는 중…';
  const box = document.createElement('div'), el = document.createElement('div');
  box.className = 'offscreen';
  el.className = 'report';
  box.appendChild(el);
  el.innerHTML = '<h1>' + esc(game.title) + ' 관리자 리포트</h1><p class="note">' + esc(describe()) + '<br>' +
    new Date(last.generatedAt).toLocaleString('ko-KR') + ' · ' + esc(viewer) + '</p><div class="grid">' + renderBlocks(last.blocks) + '</div>';
  document.body.appendChild(box);
  try {
    const html2pdf = await loadPdfLib();
    await html2pdf().set({
      margin: 8, filename: game.id + '-report-' + stamp() + '.pdf',
      image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'avoid-all'] },
    }).from(el).save();
  } catch (e) { alert(e.message); }
  box.remove();
  btn.disabled = false; btn.textContent = 'PDF 리포트';
};

// ── 내보내기 ──
function renderExports() {
  const q = query().toString();
  $('datasets').innerHTML = game.datasets.map(d =>
    '<div class="item"><div><b>' + esc(d.label) + '</b><p class="note">' + esc(d.note) + '</p></div><div class="actions">' +
    ['csv', 'json'].map(x => '<a class="btn" download href="/api/g/' + game.id + '/export/' + d.id + '.' + x + (q ? '?' + q : '') + '">' + x.toUpperCase() + '</a>').join('') +
    '</div></div>').join('');
}

// ── 설정 ──
async function loadSettings() {
  $('settings').innerHTML = '<p class="empty">불러오는 중…</p>';
  let values;
  try { values = (await api('/api/g/' + game.id + '/settings')).values; }
  catch (e) { $('settings').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; return; }
  renderSettings(values);
  loadCleanup();
}
function renderSettings(values, msg) {
  $('settings').innerHTML = game.settings.map(d => {
    const v = values.find(x => x.key === d.key);
    const who = v.updatedAt ? '마지막 변경: ' + new Date(v.updatedAt).toLocaleString('ko-KR') + (v.updatedBy ? ' · ' + esc(v.updatedBy) : '') : '기본값';
    const input = d.type === 'toggle'
      ? '<label class="switch"><input type="checkbox" data-key="' + d.key + '"' + (v.value ? ' checked' : '') + '> 켜기</label>'
      : '<div class="opts">' + d.options.map(o => '<label><input type="checkbox" data-key="' + d.key + '" value="' + o.id + '"' +
          (v.value.includes(o.id) ? ' checked' : '') + '> ' + esc(o.label) + '</label>').join('') + '</div>';
    return '<section class="card"><h2>' + esc(d.label) + '</h2><p class="note">' + esc(d.note) + '</p>' + input +
      '<div class="actions" style="margin-top:8px"><button class="primary" data-save="' + d.key + '">저장</button><span class="meta">' + who + '</span>' +
      (msg && msg.key === d.key ? '<span class="' + msg.cls + '">' + esc(msg.text) + '</span>' : '') + '</div></section>';
  }).join('');
  $('settings').querySelectorAll('[data-save]').forEach(b => b.onclick = () => save(b.dataset.save, b));
}
async function save(key, btn) {
  const d = game.settings.find(s => s.key === key);
  const boxes = [...$('settings').querySelectorAll('input[data-key="' + key + '"]')];
  const value = d.type === 'toggle' ? boxes[0].checked : boxes.filter(b => b.checked).map(b => b.value);
  if (d.type === 'toggle' && !value && !confirm(d.label + '을(를) 끌까요?')) return;
  btn.disabled = true;
  try {
    const r = await api('/api/g/' + game.id + '/settings', { method: 'PUT', headers: ACT, body: JSON.stringify({ key, value }) });
    renderSettings(r.values, r.warning ? { key, cls: 'err', text: r.warning } : { key, cls: 'ok', text: '저장했어요' });
  } catch (e) { btn.disabled = false; alert('저장하지 못했어요: ' + e.message); }
}

async function loadCleanup() {
  const c = game.cleanup;
  let items;
  try { items = (await api('/api/g/' + game.id + '/cleanup')).items; }
  catch (e) { $('cleanup').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; return; }
  const total = items.reduce((a, i) => a + i.count, 0);
  const bq = new URLSearchParams(c.backup.filter).toString();
  $('cleanup').innerHTML = '<section class="card"><h2>' + esc(c.label) + ' 정리</h2><p class="note">' + esc(c.note) + '</p>' +
    '<div class="counts">' + items.map(i => '<span>' + esc(i.label) + ' <b>' + fmt(i.count) + '</b></span>').join('') + '</div>' +
    '<div class="actions"><a class="btn" download href="/api/g/' + game.id + '/export/' + c.backup.dataset + '.csv?' + bq + '">지우기 전에 CSV 받기</a>' +
    '<button class="danger" id="wipe"' + (total ? '' : ' disabled') + '>' + (total ? '지우기' : '지울 기록 없음') + '</button></div></section>';
  $('wipe').onclick = async () => {
    const what = items.filter(i => i.count).map(i => i.label + ' ' + fmt(i.count) + '개').join(', ');
    if (!confirm(what + '를 지울까요?\\n지운 기록은 되살릴 수 없어요.')) return;
    $('wipe').disabled = true;
    try {
      const r = await api('/api/g/' + game.id + '/cleanup', { method: 'POST', headers: ACT, body: '{}' });
      alert('지웠어요: ' + r.deleted.map(i => i.label + ' ' + fmt(i.count) + '개').join(', '));
    } catch (e) { alert('지우지 못했어요: ' + e.message); }
    loadCleanup();
  };
}

// ── 탭 ──
function show() {
  document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  for (const v of ['stats', 'export', 'settings']) $('v-' + v).hidden = v !== view;
  $('filters').hidden = view === 'settings';
  if (view === 'stats') loadStats();
  if (view === 'export') renderExports();
  if (view === 'settings') loadSettings();
}
function pickGame(id) {
  game = games.find(g => g.id === id);
  document.querySelectorAll('#games button').forEach(b => b.setAttribute('aria-selected', b.dataset.game === id));
  $('level').innerHTML = '<option value="">전체</option>' + game.levels.map((l, i) => '<option value="' + (i + 1) + '">' + esc(l) + '</option>').join('');
  $('level').parentElement.hidden = !game.levels.length;
  $('client').innerHTML = '<option value="">전체 (에디터 제외)</option>';
  last = null;
  show();
}
document.querySelectorAll('#views button').forEach(b => b.onclick = () => { view = b.dataset.view; show(); });
$('period').onchange = () => { $('custom').hidden = $('period').value !== 'custom'; if ($('period').value !== 'custom') show(); };
for (const id of ['from', 'to', 'level', 'client']) $(id).onchange = () => show();
$('apply').onclick = () => show();

(async () => {
  try {
    const r = await api('/api/games');
    games = r.games; viewer = r.viewer;
    $('games').innerHTML = games.map(g => '<button data-game="' + g.id + '">' + esc(g.title) + '</button>').join('');
    document.querySelectorAll('#games button').forEach(b => b.onclick = () => pickGame(b.dataset.game));
    pickGame(games[0].id);
  } catch (e) { $('meta').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
})();
</script>
</body>
</html>`;
