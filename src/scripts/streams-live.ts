// STREAMS 실시간 통계 페이지 (src/pages/stats/streams.astro).
// 웹소켓(/api/streams/live)으로 스냅숏을 받아 SVG 로 다시 그린다. 끊기면 5초마다 /api/streams/stats 를 받고 다시 붙는다.
// 차트 색은 dataviz 검증을 통과한 역할 색: 사람 #3987e5 · AI #e66767 · 단일 계열 #22ab9b (어두운 카드 #16161c 기준).

interface LevelAgg { games: number; won: number; drawn: number; me: number; ai: number }
interface Stats {
  started: number; finished: number; won: number; drawn: number;
  todayFinished: number; todayBest: number;
  levels: LevelAgg[]; bins: number[]; heat: number[];
  playing: number; updatedAt: number;
  cards?: string[]; // 관리자가 공개로 둔 카드. 꺼진 카드의 값은 오지 않는다
}

const LEVEL_NAMES = ['입문', '보통', '숙련', '고수', '마스터'];
const C = { you: '#3987e5', ai: '#e66767', teal: '#22ab9b', draw: '#6b6a73', track: 'rgba(255,255,255,0.05)', grid: 'rgba(255,255,255,0.08)', surface: '#16161c' };
const FUNNEL = ['#7ee0d3', '#22ab9b', '#157a6e'];          // 순서형 청록 (검증 통과)
const HEAT = ['#1d5d56', '#1f8175', '#22ab9b', '#6fd6c8'];  // 연속형 청록, 적음 → 많음
const SLOTS = 20, CARDS = 30, BIN_WIDTH = 10;

const fmt = (n: number) => n.toLocaleString('ko-KR');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const svg = (w: number, h: number, body: string) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** 두 색 사이 (hex) */
function mix(a: string, b: string, t: number) {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0'));
  return `#${c.join('')}`;
}
function ramp(stops: string[], t: number) {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return mix(stops[i], stops[i + 1], x - i);
}

// ── 차트 ─────────────────────────────────────────────────────────

/** 판 흐름: 시작 → 끝까지 → AI 를 이김. 단계마다 폭이 줄고 사이는 곡선으로 좁아진다 */
function funnel(s: Stats) {
  const W = 440, H = 140, mid = H / 2, gap = 2;
  const vals = [s.started, s.finished, s.won];
  const hOf = (v: number) => (s.started > 0 ? Math.max(0.06, v / s.started) : 0.06) * (H - 8);
  const seg = W / 3;
  let body = '';
  vals.forEach((v, i) => {
    const x0 = i * seg + (i > 0 ? gap / 2 : 0), x1 = (i + 1) * seg - (i < 2 ? gap / 2 : 0);
    const h0 = hOf(v), h1 = i < 2 ? hOf(vals[i + 1]) : h0;
    const flat = x0 + (x1 - x0) * 0.62;
    const d = `M${x0},${mid - h0 / 2} L${flat},${mid - h0 / 2} C${(flat + x1) / 2},${mid - h0 / 2} ${(flat + x1) / 2},${mid - h1 / 2} ${x1},${mid - h1 / 2}
               L${x1},${mid + h1 / 2} C${(flat + x1) / 2},${mid + h1 / 2} ${(flat + x1) / 2},${mid + h0 / 2} ${flat},${mid + h0 / 2} L${x0},${mid + h0 / 2} Z`;
    const label = ['시작', '끝까지', 'AI 를 이김'][i];
    body += `<path d="${d}" fill="${FUNNEL[i]}" data-t="${label} · ${fmt(v)}판"/>`;
    const px = (x0 + flat) / 2;
    body += `<rect x="${px - 22}" y="${mid - 10}" width="44" height="20" rx="10" fill="#0c0c10" pointer-events="none"/>
             <text x="${px}" y="${mid + 4}" text-anchor="middle" style="fill:#edebe6;font-size:11px;font-weight:600" pointer-events="none">${pct(v, s.started)}%</text>`;
  });
  return svg(W, H, body);
}

/** 점수 분포: 트랙 위에 둥근 막대 */
function bins(s: Stats) {
  const W = 440, H = 170, top = 6, base = 140, n = s.bins.length, slot = W / n, bw = Math.min(26, slot - 8);
  const max = Math.max(1, ...s.bins);
  let body = '';
  s.bins.forEach((v, i) => {
    const x = i * slot + (slot - bw) / 2, h = (v / max) * (base - top);
    const range = i === n - 1 ? `${i * BIN_WIDTH}점 이상` : `${i * BIN_WIDTH}~${i * BIN_WIDTH + BIN_WIDTH - 1}점`;
    body += `<g data-t="${range} · ${fmt(v)}판">
      <rect x="${x}" y="${top}" width="${bw}" height="${base - top}" rx="6" fill="${C.track}"/>
      ${v > 0 ? `<rect x="${x}" y="${base - Math.max(h, 6)}" width="${bw}" height="${Math.max(h, 6)}" rx="6" fill="${C.teal}"/>` : ''}
      <text x="${x + bw / 2}" y="${base + 18}" text-anchor="middle">${i === n - 1 ? `${i * BIN_WIDTH}+` : i * BIN_WIDTH}</text>
    </g>`;
  });
  return svg(W, H, body);
}

/** 난이도별 평균 점수: 사람(파랑) vs AI(빨강) 레이더 */
function radar(s: Stats) {
  const W = 300, H = 240, cx = W / 2, cy = 122, R = 88;
  const avg = s.levels.map((l) => ({ me: l.games ? l.me / l.games : 0, ai: l.games ? l.ai / l.games : 0, games: l.games }));
  const max = Math.max(10, Math.ceil(Math.max(...avg.map((a) => Math.max(a.me, a.ai))) / 10) * 10);
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  let body = '';
  for (const f of [0.25, 0.5, 0.75, 1]) {
    body += `<polygon points="${[0, 1, 2, 3, 4].map((i) => pt(i, R * f).join(',')).join(' ')}" fill="none" stroke="${C.grid}" stroke-width="1"/>`;
  }
  for (let i = 0; i < 5; i++) {
    const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 18);
    body += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>
             <text x="${lx}" y="${ly + 4}" text-anchor="middle">${LEVEL_NAMES[i]}</text>`;
  }
  const series = (key: 'me' | 'ai', color: string, name: string) => {
    const pts = avg.map((a, i) => pt(i, (a[key] / max) * R));
    let g = `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    pts.forEach(([x, y], i) => {
      g += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="${C.surface}" stroke-width="2"
               data-t="${LEVEL_NAMES[i]} · ${name} 평균 ${avg[i].games ? avg[i][key].toFixed(1) : '–'}점 (${fmt(avg[i].games)}판)"/>`;
    });
    return g;
  };
  body += series('ai', C.ai, 'AI') + series('me', C.you, '사람');
  return svg(W, H, body);
}

/** 사람 승·무·패: 반원 게이지 */
function gauge(s: Stats) {
  const W = 300, H = 170, cx = W / 2, cy = 150, R = 110, sw = 20, gapDeg = 1.2;
  const lost = s.finished - s.won - s.drawn;
  const parts = [
    { v: s.won, c: C.you, t: '사람 승' },
    { v: s.drawn, c: C.draw, t: '무승부' },
    { v: lost, c: C.ai, t: 'AI 승' },
  ];
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + R * Math.cos(Math.PI + (a * Math.PI) / 180), cy + R * Math.sin(Math.PI + (a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0},${y0} A${R},${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
  };
  let body = `<path d="${arc(0, 180)}" fill="none" stroke="${C.track}" stroke-width="${sw}" stroke-linecap="round"/>`;
  if (s.finished > 0) {
    let a = 0;
    for (const p of parts) {
      const span = (p.v / s.finished) * 180;
      if (span > 0.01) {
        const a0 = a + (a > 0 ? gapDeg : 0), a1 = Math.max(a0 + 0.5, a + span);
        body += `<path d="${arc(a0, a1)}" fill="none" stroke="${p.c}" stroke-width="${sw}" stroke-linecap="round" data-t="${p.t} · ${fmt(p.v)}판 (${pct(p.v, s.finished)}%)"/>`;
      }
      a += span;
    }
  }
  body += `<text x="${cx}" y="${cy - 18}" text-anchor="middle" style="fill:#edebe6;font-size:30px;font-weight:600">${pct(s.won, s.finished)}%</text>
           <text x="${cx}" y="${cy + 2}" text-anchor="middle">사람 승률</text>`;
  return svg(W, H, body);
}

/** 첫 카드 자리: 세로 카드 1~30 × 가로 칸 1~20 */
function heat(s: Stats) {
  const cw = 34, ch = 12, left = 30, top = 18, W = left + SLOTS * cw, H = top + CARDS * ch + 4;
  const max = Math.max(1, ...s.heat);
  let body = '';
  for (let slot = 0; slot < SLOTS; slot++) {
    if (slot % 5 === 0 || slot === SLOTS - 1) body += `<text x="${left + slot * cw + cw / 2}" y="11" text-anchor="middle">${slot + 1}칸</text>`;
  }
  for (let card = 1; card <= CARDS; card++) {
    const y = top + (card - 1) * ch;
    if (card === 1 || card % 5 === 0) body += `<text x="${left - 6}" y="${y + ch - 2}" text-anchor="end">${card}</text>`;
    for (let slot = 0; slot < SLOTS; slot++) {
      const n = s.heat[(card - 1) * SLOTS + slot];
      const fill = n === 0 ? 'rgba(255,255,255,0.025)' : ramp(HEAT, Math.sqrt(n / max));
      body += `<rect x="${left + slot * cw + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${fill}"
                data-t="첫 카드 ${card} → ${slot + 1}번째 칸 · ${fmt(n)}번"/>`;
    }
  }
  return svg(W, H, body);
}

// ── 그리기 ───────────────────────────────────────────────────────

function render(root: HTMLElement, s: Stats) {
  const set = (k: string, v: string) => root.querySelectorAll(`[data-v="${k}"]`).forEach((e) => (e.textContent = v));
  const put = (sel: string, html: string) => { const e = root.querySelector(sel); if (e) e.innerHTML = html; };
  const on = (card: string) => !s.cards || s.cards.includes(card);
  root.querySelectorAll<HTMLElement>('[data-card]').forEach((e) => (e.hidden = !on(e.dataset.card!)));

  if (on('tiles')) {
    set('playing', fmt(s.playing));
    set('todayFinished', fmt(s.todayFinished));
    set('todayBest', s.todayFinished ? fmt(s.todayBest) : '–');
    set('finished', fmt(s.finished));
  }
  if (on('funnel')) {
    set('started', fmt(s.started));
    set('finishRate', s.started ? `${pct(s.finished, s.started)}% 완주` : '');
    put('[data-chart="funnel"]', funnel(s));
    put('[data-stats="funnel"]', [['시작', s.started, FUNNEL[0]], ['끝까지', s.finished, FUNNEL[1]], ['AI 를 이김', s.won, FUNNEL[2]]]
      .map(([t, v, c]) => `<div class="st"><i style="background:${c}"></i>${t}<b>${fmt(v as number)}</b></div>`).join(''));
  }
  if (on('bins')) {
    const meSum = s.levels.reduce((a, l) => a + l.me, 0);
    set('avg', s.finished ? (meSum / s.finished).toFixed(1) : '–');
    put('[data-chart="bins"]', bins(s));
  }
  if (on('radar')) {
    set('levelsPlayed', String(s.levels.filter((l) => l.games > 0).length));
    put('[data-chart="radar"]', radar(s));
    put('[data-stats="levels"]', s.levels.map((l, i) =>
      `<div class="st">${LEVEL_NAMES[i]}<b>${l.games ? `${pct(l.won, l.games)}%` : '–'}</b></div>`).join(''));
  }
  if (on('gauge')) {
    set('winRate', String(pct(s.won, s.finished)));
    put('[data-chart="gauge"]', gauge(s));
    put('[data-stats="gauge"]', [['사람 승', s.won, C.you], ['무승부', s.drawn, C.draw], ['AI 승', s.finished - s.won - s.drawn, C.ai]]
      .map(([t, v, c]) => `<div class="st"><i style="background:${c}"></i>${t}<b>${fmt(v as number)}</b></div>`).join(''));
  }
  if (on('heat')) {
    set('firstMoves', fmt(s.heat.reduce((a, b) => a + b, 0)));
    put('[data-chart="heat"]', heat(s));
  }
}

// ── 연결 ─────────────────────────────────────────────────────────

export function startLive(root: HTMLElement) {
  if (root.dataset.started) return;
  root.dataset.started = '1';

  let ws: WebSocket | null = null, poll = 0, retry = 0, backoff = 5000, closed = false;

  const fetchOnce = () => fetch('/api/streams/stats').then((r) => r.json()).then((s: Stats) => render(root, s)).catch(() => {});

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/streams/live`);
    ws.onopen = () => {
      backoff = 5000;
      clearInterval(poll);
    };
    ws.onmessage = (e) => render(root, JSON.parse(e.data));
    ws.onclose = () => {
      if (closed) return;
      clearInterval(poll);
      poll = window.setInterval(fetchOnce, 5000);
      retry = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
    };
  };

  fetchOnce();
  connect();

  // 막대·점·칸에 올리면 값을 보여 준다
  const tip = root.querySelector<HTMLElement>('[data-tip]')!;
  root.addEventListener('pointermove', (e) => {
    const t = (e.target as Element).closest?.('[data-t]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-t');
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  root.addEventListener('pointerleave', () => (tip.hidden = true));

  // 다른 페이지로 넘어가면 연결을 닫는다
  document.addEventListener('astro:before-swap', () => {
    closed = true;
    clearInterval(poll);
    clearTimeout(retry);
    ws?.close();
  }, { once: true });
}
