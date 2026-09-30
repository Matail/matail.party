// 관리자 페이지 (한 장짜리 HTML). /api/overview 를 받아 그린다. 색은 공개 통계 페이지와 같은 역할 색.
export const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>STREAMS 관리자 통계</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  :root { --bg:#0a0a0f; --card:#111116; --panel:#16161c; --line:rgba(255,255,255,.07); --ink:#edebe6; --ink-2:#a7a5ae; --ink-3:#7c7a84;
          --you:#3987e5; --ai:#e66767; --teal:#22ab9b; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; }
  header { display: flex; justify-content: space-between; align-items: end; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  h1 { font-size: 1.6rem; margin: 0; }
  .meta { color: var(--ink-3); font-size: .85rem; }
  button { font: inherit; font-size: .85rem; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 6px 12px; cursor: pointer; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
  .tile span { display: block; font-size: .78rem; color: var(--ink-2); }
  .tile b { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
  .tile small { color: var(--ink-3); font-size: .75rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 16px; }
  section.wide { grid-column: 1 / -1; }
  h2 { font-size: .95rem; margin: 0 0 4px; }
  section > p { color: var(--ink-3); font-size: .8rem; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--ink-3); font-weight: 500; }
  td.n, th.n { text-align: right; }
  .row { display: grid; grid-template-columns: 7.5rem 1fr 5.5rem; gap: 10px; align-items: center; font-size: .82rem; margin: 7px 0; }
  .track { height: 10px; border-radius: 5px; background: rgba(255,255,255,.05); overflow: hidden; }
  .fill { height: 100%; border-radius: 5px; background: var(--teal); }
  .fill.warn { background: var(--ai); }
  .num { text-align: right; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .res { font-size: .72rem; font-weight: 600; padding: 2px 6px; border-radius: 6px; }
  .win { background: rgba(57,135,229,.18); color: #9cc4f5; } .lose { background: rgba(230,103,103,.18); color: #f2a9a9; } .draw { background: rgba(255,255,255,.08); color: var(--ink-2); }
  .err { color: #f2a9a9; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <header>
    <div><h1>STREAMS 관리자 통계</h1><div class="meta" id="meta">불러오는 중…</div></div>
    <button id="reload">새로고침</button>
  </header>
  <div class="tiles" id="tiles"></div>
  <div class="grid">
    <section><h2>데이터 품질</h2><p>학습에 넣는 판(streams_clean_games)과 규칙으로 빠진 판. 한 판이 여러 이유로 빠질 수 있어요.</p><div id="quality"></div></section>
    <section><h2>행동 기록</h2><p>최근 <span class="days"></span>일, 에디터·로컬 테스트 제외.</p><div id="behavior"></div></section>
    <section><h2>생각 시간</h2><p>학습용 턴(streams_clean_turns)의 카드를 보고 놓기까지 걸린 시간. 빨간 칸은 품질 규칙의 느린 턴.</p><div id="think"></div></section>
    <section><h2>클라이언트</h2><p>최근 30일 끝난 판.</p><div id="clients"></div></section>
    <section class="wide"><h2>최근 끝난 판</h2><p>공개 페이지엔 없는 판 하나하나. 누가 뒀는지(player_id)는 보여 주지 않아요.</p><div id="recent"></div></section>
  </div>
</main>
<script>
const LV = ['입문', '보통', '숙련', '고수', '마스터'];
const fmt = n => Number(n || 0).toLocaleString('ko-KR');
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const $ = id => document.getElementById(id);
const bar = (label, v, max, text, warn) =>
  '<div class="row"><span>' + esc(label) + '</span><span class="track"><span class="fill' + (warn ? ' warn' : '') + '" style="display:block;width:' + pct(v, max) + '%"></span></span><span class="num">' + text + '</span></div>';
const kst = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

async function load() {
  $('meta').textContent = '불러오는 중…';
  let d;
  try {
    const r = await fetch('/api/overview', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status + ' ' + await r.text());
    d = await r.json();
  } catch (e) { $('meta').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; return; }

  $('meta').textContent = esc(d.viewer) + ' · ' + new Date(d.generatedAt).toLocaleString('ko-KR');
  document.querySelectorAll('.days').forEach(e => e.textContent = d.days);
  const b = d.behavior, ev = b.events, q = d.quality;
  const tile = (l, v, s) => '<div class="tile"><span>' + l + '</span><b>' + v + '</b>' + (s ? '<br><small>' + s + '</small>' : '') + '</div>';
  $('tiles').innerHTML =
    tile('학습용 판', fmt(q.clean), '끝난 판 ' + fmt(q.finished) + ' 중 ' + pct(q.clean, q.finished) + '%') +
    tile('시작한 판 (' + d.days + '일)', fmt(b.started), '끝까지 ' + pct(b.finished, b.started) + '%') +
    tile('포기율', pct(ev.abandon || 0, b.started) + '%', '포기 ' + fmt(ev.abandon) + '판') +
    tile('재대전율', pct(ev.rematch || 0, b.finished) + '%', '한 판 더 ' + fmt(ev.rematch) + '번') +
    tile('세션', fmt(b.sessions.count), '평균 ' + Math.round(b.sessions.avgSec / 60) + '분 · 기록 ' + b.sessions.avgEvents + '개');

  const ex = q.excluded, exMax = Math.max(1, q.games);
  $('quality').innerHTML =
    bar('학습용', q.clean, exMax, fmt(q.clean)) +
    bar('에디터·로컬', ex.editor, exMax, fmt(ex.editor), true) +
    bar('다시 둔 턴', ex.retried, exMax, fmt(ex.retried), true) +
    bar('20턴 미만 끝', ex.short, exMax, fmt(ex.short), true) +
    bar('AI 대전 아님', ex.pvp, exMax, fmt(ex.pvp), true) +
    bar('끝나지 않음', q.games - q.finished, exMax, fmt(q.games - q.finished), true);

  const types = Object.entries(ev).sort((a, c) => c[1] - a[1]), evMax = Math.max(1, ...types.map(t => t[1]));
  $('behavior').innerHTML = (types.length ? types.map(([t, n]) => bar(t, n, evMax, fmt(n))).join('') : '<p class="meta">아직 기록이 없어요</p>') +
    '<p class="meta" style="margin-top:12px">망설임: ' + fmt(b.hover.count) + '번 · 평균 ' + (b.hover.avgMs / 1000).toFixed(1) + '초 · 판당 ' +
    (b.hover.games ? (b.hover.count / b.hover.games).toFixed(1) : '–') + '번</p>';

  const tMax = Math.max(1, ...d.think.counts), tSum = d.think.counts.reduce((a, c) => a + c, 0);
  $('think').innerHTML = d.think.buckets.map((l, i) => bar(l, d.think.counts[i], tMax, fmt(d.think.counts[i]) + ' · ' + pct(d.think.counts[i], tSum) + '%', i === d.think.buckets.length - 1)).join('');

  $('clients').innerHTML = d.clients.length
    ? '<table><tr><th>클라이언트</th><th class="n">판</th><th class="n">평균 점수</th><th class="n">사람 승률</th></tr>' +
      d.clients.map(c => '<tr><td>' + esc(c.kind) + '</td><td class="n">' + fmt(c.games) + '</td><td class="n">' + c.avgMe + '</td><td class="n">' + pct(c.won, c.games) + '%</td></tr>').join('') + '</table>'
    : '<p class="meta">아직 끝난 판이 없어요</p>';

  $('recent').innerHTML = d.recent.length
    ? '<table><tr><th>끝난 시각(KST)</th><th>난이도</th><th class="n">사람</th><th class="n">AI</th><th></th><th class="n">걸린 시간</th><th>클라이언트</th></tr>' +
      d.recent.map(r => {
        const res = r.me > r.ai ? ['win', '사람 승'] : r.me < r.ai ? ['lose', 'AI 승'] : ['draw', '무'];
        return '<tr><td>' + kst(r.finishedAt) + '</td><td>' + (LV[r.level - 1] || '-') + '</td><td class="n">' + r.me + '</td><td class="n">' + r.ai +
          '</td><td><span class="res ' + res[0] + '">' + res[1] + '</span></td><td class="n">' + Math.floor(r.seconds / 60) + '분 ' + (r.seconds % 60) + '초</td><td>' + esc(r.client || '헤더 없음') + '</td></tr>';
      }).join('') + '</table>'
    : '<p class="meta">아직 끝난 판이 없어요</p>';
}
$('reload').onclick = load;
load();
setInterval(load, 60000);
</script>
</body>
</html>`;
