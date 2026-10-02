// 통계 탭 개요 (src/pages/stats/index.astro).
// 게임별 통계 페이지와 같은 웹소켓 두 개(/api/streams/live · /api/aimbooster/live)에서 스냅숏을 받아 카드 · 차트를 다시 그린다.
// 끊기면 5초마다 /stats 를 받고 다시 붙는다 (streams-live.ts · aimbooster-live.ts 와 같은 방식).
// 실시간 소식: 서버는 판 하나하나를 내보내지 않는다(공개는 합계 · 분포뿐). 이 페이지가 받은 스냅숏이 직전보다
// 늘어난 만큼(시작 수 · 끝난 수 · 분포 칸)을 판으로 풀어 보여 줄 뿐이고, 어디에도 저장하지 않는다.
// STREAMS 는 관리자가 끈 공개 카드(cards)를 따른다 — 그 카드가 쓰는 값으로 만든 개요 카드 · 소식 내용도 숨긴다.
// 색은 게임별 페이지와 같은 역할 색: 사람 #3987e5 · AI #e66767 · 단일 계열 #22ab9b (어두운 카드 #16161c 기준).

interface LevelAgg { games: number; won: number; drawn: number; me: number; ai: number }
interface StreamsStats {
  day: string; updatedAt: number; cards?: string[];
  playing?: number; started?: number; finished?: number; won?: number; drawn?: number;
  todayFinished?: number; todayBest?: number; best?: number;
  levels?: LevelAgg[]; bins?: number[];
}
interface AimStats {
  day: string; updatedAt: number;
  playing: number; started: number; finished: number; best: number; todayFinished: number; todayBest: number;
  accuracyAll: number;
  survivalBinMs: number; survival: number[];
  accuracy: number[];
  reactionBinMs: number; reaction: number[];
}
interface Game { id: 'streams' | 'aimbooster'; title: string; accent: string; url: string }
interface Event {
  at: number; game: Game['id'];
  kind: 'start' | 'win' | 'lose' | 'draw' | 'done' | 'many';
  record: string; detail: string; best?: boolean;
}

const LEVEL_NAMES = ['입문', '보통', '숙련', '고수', '마스터'];
const C = { you: '#3987e5', ai: '#e66767', teal: '#22ab9b', draw: '#6b6a73', grid: 'rgba(255,255,255,0.06)', surface: '#16161c' };
const FEED_KEEP = 50, FEED_SHOW = 10, PER_DIFF = 6;

const fmt = (n: number) => n.toLocaleString('ko-KR');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const svg = (w: number, h: number, body: string) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 누적이 q 를 넘는 칸 (판이 없으면 -1) */
function quantileBin(a: number[], q: number) {
  const total = sum(a);
  if (total === 0) return -1;
  let acc = 0;
  for (let i = 0; i < a.length; i++) if ((acc += a[i]) >= total * q) return i;
  return a.length - 1;
}

/** 직전보다 늘어난 칸 번호를 늘어난 만큼 (줄어든 칸은 집계를 다시 센 것이라 무시) */
function grown(prev: number[] | undefined, next: number[] | undefined) {
  const out: number[] = [];
  if (!prev || !next) return out;
  for (let i = 0; i < next.length; i++) for (let k = (prev[i] ?? 0); k < next[i]; k++) out.push(i);
  return out;
}

/** 단조 3차 곡선 (Fritsch–Carlson) — 0 아래로 넘치지 않는 부드러운 선 */
function smooth(p: [number, number][]) {
  const n = p.length;
  if (n === 0) return '';
  if (n < 3) return p.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${p[i][0] + h},${p[i][1] + t[i] * h} ${p[i + 1][0] - h},${p[i + 1][1] - t[i + 1] * h} ${p[i + 1][0]},${p[i + 1][1]}`;
  }
  return d;
}

// ── 차트 ─────────────────────────────────────────────────────────

/** 난이도별 평균 점수: 사람(파랑, 옅은 면) vs AI(빨강 점선). 난이도 칸에 올리면 두 값을 같이 보여 준다 */
function scoreChart(levels: LevelAgg[], W: number) {
  const H = 150, left = 26, right = 36, top = 12, base = 120;
  const avg = levels.map((l) => (l.games ? { me: l.me / l.games, ai: l.ai / l.games, games: l.games } : null));
  const max = Math.max(10, Math.ceil(Math.max(0, ...avg.map((a) => (a ? Math.max(a.me, a.ai) : 0))) / 20) * 20);
  const step = (W - left - right) / (levels.length - 1);
  const x = (i: number) => left + i * step, y = (v: number) => base - (v / max) * (base - top);
  let body = '';
  for (const f of [0, 0.5, 1]) {
    body += `<line x1="${left}" x2="${W - right}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="${C.grid}" stroke-width="1"/>
             <text x="${left - 8}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`;
  }
  const pts = (k: 'me' | 'ai') => avg.flatMap((a, i) => (a ? [[x(i), y(a[k])] as [number, number]] : []));
  const me = pts('me'), ai = pts('ai');
  if (me.length > 1) {
    const line = smooth(me);
    body += `<defs><linearGradient id="ov-me" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.you}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.you}" stop-opacity="0"/></linearGradient></defs>
             <path d="${line}L${me.at(-1)![0]},${base}L${me[0][0]},${base}Z" fill="url(#ov-me)"/>`;
  }
  body += `<path d="${smooth(ai)}" fill="none" stroke="${C.ai}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>`;
  body += `<path d="${smooth(me)}" fill="none" stroke="${C.you}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  // 끝점: 마지막으로 둔 난이도에 점과 이름
  const end = (p: [number, number][], color: string, name: string) => (p.length
    ? `<circle cx="${p.at(-1)![0]}" cy="${p.at(-1)![1]}" r="4.5" fill="${color}" stroke="${C.surface}" stroke-width="2"/>
       <text x="${p.at(-1)![0] + 10}" y="${p.at(-1)![1] + 4}" style="fill:#a7a5ae">${name}</text>` : '');
  const close = me.length && ai.length && Math.abs(me.at(-1)![1] - ai.at(-1)![1]) < 14;
  body += end(ai, C.ai, close ? '' : 'AI') + end(me, C.you, close ? '' : '사람');
  // 난이도 칸: 올리면 세로 선 + 값
  levels.forEach((_, i) => {
    const a = avg[i];
    const t = a ? `${LEVEL_NAMES[i]} · 사람 ${a.me.toFixed(1)}점 · AI ${a.ai.toFixed(1)}점 (${fmt(a.games)}판)` : `${LEVEL_NAMES[i]} · 아직 판이 없어요`;
    body += `<g class="col" data-t="${t}">
      <rect x="${x(i) - step / 2}" y="${top - 6}" width="${step}" height="${base - top + 26}" fill="transparent"/>
      <line class="cross" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${base}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      <text x="${x(i)}" y="${base + 20}" text-anchor="middle">${LEVEL_NAMES[i]}</text>
    </g>`;
  });
  return svg(W, H, body);
}

interface Curve {
  counts: number[];
  tip: (i: number) => string;
  mark: number;          // 표시할 칸 (중앙값)
  markLabel: string;
}

/** 분포 곡선: 청록 선 + 옅은 면, 중앙값에 점선과 이름표. 칸에 올리면 범위와 판 수 */
function curve({ counts, tip, mark, markLabel }: Curve, id: string, W: number) {
  const H = 92, top = 22, base = 86, n = counts.length;
  const max = Math.max(1, ...counts), step = W / Math.max(1, n - 1);
  const pts = counts.map((v, i) => [i * step, base - (v / max) * (base - top)] as [number, number]);
  const line = smooth(pts);
  let body = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.teal}" stop-opacity="0.24"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="${C.grid}" stroke-width="1"/>
    <path d="${line}L${W},${base}L0,${base}Z" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${C.teal}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (mark >= 0 && mark < n) {
    const [mx, my] = pts[mark], w = markLabel.length * 6.4 + 14, lx = Math.min(W - w / 2, Math.max(w / 2, mx));
    body += `<line x1="${mx}" x2="${mx}" y1="${top - 2}" y2="${base}" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="3 3"/>
      <rect x="${lx - w / 2}" y="0" width="${w}" height="17" rx="8.5" fill="#24242c"/>
      <text x="${lx}" y="12.5" text-anchor="middle" style="fill:#edebe6;font-size:10.5px;font-weight:600">${markLabel}</text>
      <circle cx="${mx}" cy="${my}" r="4.5" fill="${C.teal}" stroke="${C.surface}" stroke-width="2"/>`;
  }
  counts.forEach((_, i) => {
    body += `<g class="col" data-t="${tip(i)}">
      <rect x="${i * step - step / 2}" y="${top - 4}" width="${step}" height="${base - top + 8}" fill="transparent"/>
      <line class="cross" x1="${i * step}" x2="${i * step}" y1="${top}" y2="${base}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
    </g>`;
  });
  return svg(W, H, body);
}

/** 반응 시간(판별 중앙값): 25ms 칸을 50ms 로 묶어 1초까지 (그 위는 마지막 칸에) */
function reactionCurve(s: AimStats, W: number) {
  const STEP = 50, MAX = 1000, per = STEP / s.reactionBinMs, n = MAX / STEP;
  const counts = Array.from({ length: n }, (_, i) => sum(s.reaction.slice(i * per, (i + 1) * per)));
  counts[n - 1] += sum(s.reaction.slice(n * per));
  const med = quantileBin(s.reaction, 0.5);
  return curve({
    counts,
    tip: (i) => `${i * STEP}${i === n - 1 ? 'ms 이상' : `~${(i + 1) * STEP}ms`} · ${fmt(counts[i])}판`,
    mark: med < 0 ? -1 : Math.min(n - 1, Math.floor((med * s.reactionBinMs) / STEP)),
    markLabel: med < 0 ? '' : `${Math.round((med + 0.5) * s.reactionBinMs)}ms`,
  }, 'ov-react', W);
}

/** 버틴 시간: 0.5초 칸을 넓게 묶어 점 40개 이하로. 오른쪽 끝은 위 2% 를 빼고 (적어도 1분) */
function survivalCurve(s: AimStats, W: number) {
  const perSec = 1000 / s.survivalBinMs;
  const p98 = quantileBin(s.survival, 0.98);
  const span = Math.max(60 * perSec, p98 + 1);
  const stepSec = [1, 2, 5, 10, 15, 30, 60].find((t) => span / (t * perSec) <= 40) ?? 60;
  const per = stepSec * perSec, n = Math.ceil(span / per);
  const counts = Array.from({ length: n }, (_, i) => sum(s.survival.slice(i * per, (i + 1) * per)));
  counts[n - 1] += sum(s.survival.slice(n * per));
  const med = quantileBin(s.survival, 0.5);
  return curve({
    counts,
    tip: (i) => `${i * stepSec}${i === n - 1 ? '초 이상' : `~${(i + 1) * stepSec}초`} · ${fmt(counts[i])}판`,
    mark: med < 0 ? -1 : Math.min(n - 1, Math.floor(med / per)),
    markLabel: med < 0 ? '' : `${((med + 0.5) * s.survivalBinMs / 1000).toFixed(1)}초`,
  }, 'ov-surv', W);
}

/** 가로 미터: 값마다 한 칸 (0 인 칸은 빼고), 칸마다 올리면 이름과 값 */
const meter = (parts: { v: number; c: string; t: string }[]) => {
  const total = sum(parts.map((p) => p.v));
  return total > 0
    ? parts.filter((p) => p.v > 0).map((p) => `<span style="flex:${p.v} 1 0;background:${p.c}" data-t="${p.t} · ${fmt(p.v)}판 (${pct(p.v, total)}%)"></span>`).join('')
    : '';
};

// ── 실시간 소식 ──────────────────────────────────────────────────

const ICON: Record<Event['kind'], string> = {
  start: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#7c7a84" stroke-width="1.5"/><path d="M6.6 5.4v5.2L10.6 8z" fill="#a7a5ae"/></svg>`,
  win: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${C.you}"/><path d="M4.9 8.2l2 2 4.2-4.3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lose: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${C.ai}"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  draw: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${C.draw}"/><path d="M5.2 6.6h5.6M5.2 9.4h5.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  done: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="${C.teal}" stroke-width="1.5"/><path d="M4.9 8.2l2 2 4.2-4.3" fill="none" stroke="${C.teal}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  many: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="${C.teal}" stroke-width="1.5"/><path d="M5 8h6M8 5v6" stroke="${C.teal}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};
const UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const KIND_TEXT: Record<Event['kind'], string> = { start: '시작', win: '사람 승', lose: 'AI 승', draw: '무승부', done: '끝남', many: '여러 판' };

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

/** STREAMS 스냅숏 두 장 사이에 생긴 일. 꺼진 카드의 값은 오지 않으므로 있는 값만 쓴다 */
function streamsEvents(a: StreamsStats, b: StreamsStats, now: number): Event[] {
  const on = (c: string) => !b.cards || b.cards.includes(c);
  const out: Event[] = [];
  const started = on('funnel') && a.started !== undefined && b.started !== undefined ? b.started - a.started : 0;
  for (let i = 0; i < Math.min(started, PER_DIFF); i++) out.push({ at: now, game: 'streams', kind: 'start', record: '–', detail: '새 판을 시작했어요' });

  const done = a.finished !== undefined && b.finished !== undefined ? b.finished - a.finished : 0;
  if (done <= 0) return out;
  if (done > PER_DIFF) return [...out, { at: now, game: 'streams', kind: 'many', record: `${fmt(done)}판`, detail: `${fmt(done)}판이 한꺼번에 끝났어요` }];

  const games: Event[] = [];
  const la = a.levels, lb = b.levels;
  if (on('radar') && la && lb) {
    lb.forEach((l, i) => {
      const p = la[i] ?? { games: 0, won: 0, drawn: 0, me: 0, ai: 0 };
      const n = l.games - p.games;
      if (n <= 0) return;
      if (n === 1) {
        const me = l.me - p.me, ai = l.ai - p.ai;
        const kind = on('gauge') ? (me > ai ? 'win' : me === ai ? 'draw' : 'lose') : 'done';
        const best = on('tiles') && b.todayBest !== undefined && b.todayBest > (a.day === b.day ? a.todayBest ?? 0 : 0) && b.todayBest === me;
        games.push({ at: now, game: 'streams', kind, record: `${me}점`, detail: `${LEVEL_NAMES[i]} · AI ${ai}점`, best });
      } else {
        games.push({ at: now, game: 'streams', kind: 'many', record: `${n}판`, detail: `${LEVEL_NAMES[i]}에서 ${n}판이 끝났어요` });
      }
    });
  }
  // 난이도를 못 보면 점수 칸으로, 그것도 없으면 "끝남" 만
  if (games.length === 0) {
    const bins = on('bins') ? grown(a.bins, b.bins) : [];
    for (let k = 0; k < done; k++) {
      const bin = bins.length === done ? bins[k] : -1;
      games.push({ at: now, game: 'streams', kind: 'done', record: bin < 0 ? '–' : bin >= 10 ? '100점 이상' : `${bin * 10}점대`, detail: '한 판이 끝났어요' });
    }
  }
  return [...out, ...games];
}

/** AIMBOOSTER 스냅숏 두 장 사이에 생긴 일 */
function aimEvents(a: AimStats, b: AimStats, now: number): Event[] {
  const out: Event[] = [];
  const started = b.started - a.started;
  for (let i = 0; i < Math.min(started, PER_DIFF); i++) out.push({ at: now, game: 'aimbooster', kind: 'start', record: '–', detail: '새 판을 시작했어요' });

  const done = b.finished - a.finished;
  if (done <= 0) return out;
  if (done > PER_DIFF) return [...out, { at: now, game: 'aimbooster', kind: 'many', record: `${fmt(done)}판`, detail: `${fmt(done)}판이 한꺼번에 끝났어요` }];

  const surv = grown(a.survival, b.survival);
  const newBest = b.todayBest > (a.day === b.day ? a.todayBest : 0) && b.todayFinished > 0 ? b.todayBest : 0;
  if (done === 1) {
    const acc = grown(a.accuracy, b.accuracy), react = grown(a.reaction, b.reaction);
    const parts = [];
    if (acc.length === 1) parts.push(`명중률 ${acc[0]}%`);
    if (react.length === 1) parts.push(`반응 약 ${Math.round(((react[0] + 0.5) * b.reactionBinMs) / 10) * 10}ms`);
    const record = newBest ? sec(newBest) : surv.length === 1 ? sec(surv[0] * b.survivalBinMs) : '–';
    return [...out, { at: now, game: 'aimbooster', kind: 'done', record, detail: parts.join(' · ') || '한 판이 끝났어요', best: !!newBest }];
  }
  const top = surv.length ? Math.max(...surv) : -1;
  for (let k = 0; k < done; k++) {
    const bin = surv.length === done ? surv[k] : -1;
    const best = !!newBest && bin === top && k === surv.indexOf(top);
    out.push({ at: now, game: 'aimbooster', kind: 'done', record: best ? sec(newBest) : bin < 0 ? '–' : sec(bin * b.survivalBinMs), detail: '한 판이 끝났어요', best });
  }
  return out;
}

// ── 연결 ─────────────────────────────────────────────────────────

/** 웹소켓으로 받고, 끊기면 5초마다 HTTP 로 받으며 다시 붙는다. 순서가 뒤바뀐 옛 스냅숏은 버린다 */
function subscribe<T extends { updatedAt: number }>(name: string, onData: (s: T) => void, onState: () => void) {
  let ws: WebSocket | null = null, poll = 0, retry = 0, backoff = 5000, closed = false, last = 0;
  const live = { state: 'wait' as 'wait' | 'live' | 'poll', close: () => {} };
  const take = (s: T) => {
    if (!s || typeof s.updatedAt !== 'number' || s.updatedAt < last) return;
    last = s.updatedAt;
    onData(s);
  };
  const fetchOnce = () => fetch(`/api/${name}/stats`).then((r) => r.json()).then(take).catch(() => {});
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/${name}/live`);
    ws.onopen = () => {
      backoff = 5000;
      clearInterval(poll);
      live.state = 'live';
      onState();
    };
    ws.onmessage = (e) => { try { take(JSON.parse(e.data)); } catch { /* 깨진 메시지 */ } };
    ws.onclose = () => {
      if (closed) return;
      clearInterval(poll);
      poll = window.setInterval(fetchOnce, 5000);
      retry = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
      live.state = 'poll';
      onState();
    };
  };
  fetchOnce();
  connect();
  live.close = () => {
    closed = true;
    clearInterval(poll);
    clearTimeout(retry);
    ws?.close();
  };
  return live;
}

export function startOverview(root: HTMLElement) {
  if (root.dataset.started) return;
  root.dataset.started = '1';

  const games: Game[] = JSON.parse(root.dataset.games ?? '[]');
  const gameOf = (id: Game['id']) => games.find((g) => g.id === id)!;
  let streams: StreamsStats | null = null, aim: AimStats | null = null;
  let feed: Event[] = [], filter: 'all' | Game['id'] = 'all';

  const $ = <E extends Element = HTMLElement>(sel: string) => root.querySelector<E>(sel);
  const set = (k: string, v: string) => root.querySelectorAll(`[data-v="${k}"]`).forEach((e) => (e.textContent = v));
  const put = (sel: string, html: string) => { const e = $(sel); if (e && e.innerHTML !== html) e.innerHTML = html; };
  const show = (card: string, on: boolean) => { const e = $(`[data-card="${card}"]`); if (e) e.hidden = !on; };
  /** 차트는 칸의 실제 폭으로 그린다 — viewBox 가 칸보다 넓으면 글씨가 줄어든다 */
  const widthOf = (chart: string, fallback: number) => Math.max(160, Math.round($(`[data-chart="${chart}"]`)?.clientWidth || fallback));

  function renderCards() {
    const sOn = (c: string) => !!streams && (!streams.cards || streams.cards.includes(c));

    // 난이도별 평균 점수 (STREAMS radar 카드)
    const levels = sOn('radar') ? streams!.levels : undefined;
    show('score', !!levels || !streams);
    if (levels) {
      const g = sum(levels.map((l) => l.games));
      set('sAvg', g ? (sum(levels.map((l) => l.me)) / g).toFixed(1) : '–');
      set('sAiAvg', g ? `${(sum(levels.map((l) => l.ai)) / g).toFixed(1)}점` : '–');
      const top = levels.reduce((b, l, i) => (l.games > levels[b].games ? i : b), 0);
      set('sTopLevel', g ? LEVEL_NAMES[top] : '–');
      put('[data-chart="score"]', scoreChart(levels, widthOf('score', 420)));
    }

    // 사람 승률 (STREAMS gauge 카드)
    const gauge = sOn('gauge') && streams!.finished !== undefined;
    show('win', gauge || !streams);
    if (gauge) {
      const s = streams!, won = s.won ?? 0, drawn = s.drawn ?? 0, fin = s.finished ?? 0, lost = Math.max(0, fin - won - drawn);
      set('sWinRate', fin ? String(pct(won, fin)) : '–');
      set('sWon', fmt(won));
      set('sLost', fmt(lost));
      put('[data-meter="win"]', meter([{ v: won, c: C.you, t: '사람 승' }, { v: drawn, c: C.draw, t: '무승부' }, { v: lost, c: C.ai, t: 'AI 승' }]));
    }

    // AIMBOOSTER 반응 · 버틴 시간
    if (aim) {
      const r50 = quantileBin(aim.reaction, 0.5), r10 = quantileBin(aim.reaction, 0.1), r90 = quantileBin(aim.reaction, 0.9);
      const ms = (i: number) => Math.round((i + 0.5) * aim!.reactionBinMs);
      set('aReaction', r50 < 0 ? '–' : String(ms(r50)));
      set('aReactionFast', r10 < 0 ? '–' : `${ms(r10)}ms`);
      set('aReactionSlow', r90 < 0 ? '–' : `${ms(r90)}ms`);
      put('[data-chart="reaction"]', reactionCurve(aim, widthOf('reaction', 220)));

      const s50 = quantileBin(aim.survival, 0.5), s90 = quantileBin(aim.survival, 0.9);
      const secs = (i: number) => (((i + 0.5) * aim!.survivalBinMs) / 1000).toFixed(1);
      set('aSurvival', s50 < 0 ? '–' : secs(s50));
      set('aSurvivalTop', s90 < 0 ? '–' : `${secs(s90)}초`);
      set('aBest', aim.finished ? sec(aim.best) : '–');
      put('[data-chart="survival"]', survivalCurve(aim, widthOf('survival', 220)));
    }

    // 시작한 판: 두 게임 합. STREAMS 판 흐름 카드가 꺼져 있으면 AIMBOOSTER 만
    const runs = [aim && { started: aim.started, finished: aim.finished, playing: aim.playing },
      sOn('funnel') && streams!.started !== undefined && { started: streams!.started!, finished: streams!.finished ?? 0, playing: streams!.playing ?? 0 }]
      .filter(Boolean) as { started: number; finished: number; playing: number }[];
    if (runs.length) {
      const started = sum(runs.map((r) => r.started)), finished = sum(runs.map((r) => r.finished)), playing = sum(runs.map((r) => r.playing));
      const quit = Math.max(0, started - finished - playing);
      set('started', fmt(started));
      set('finishedAll', fmt(finished));
      set('abandoned', fmt(quit));
      put('[data-meter="runs"]', meter([
        { v: finished, c: C.teal, t: '끝까지' },
        { v: Math.max(0, Math.min(playing, started - finished)), c: C.you, t: '하는 중' },
        { v: quit, c: 'rgba(255,255,255,0.12)', t: '중간에 그만둠' },
      ]));
    }

    // 게임별 오늘
    const rows: Record<Game['id'], { playing?: number; today?: number; finished?: number; todayBest?: number; best?: number; unit: (v: number) => string } | null> = {
      streams: sOn('tiles') ? { playing: streams!.playing, today: streams!.todayFinished, finished: streams!.finished, todayBest: streams!.todayBest, best: streams!.best, unit: (v) => `${fmt(v)}점` } : null,
      aimbooster: aim ? { playing: aim.playing, today: aim.todayFinished, finished: aim.finished, todayBest: aim.todayBest, best: aim.best, unit: sec } : null,
    };
    for (const [id, r] of Object.entries(rows)) {
      const el = $(`[data-game="${id}"]`);
      if (!el) continue;
      el.closest('li')!.hidden = id === 'streams' && !!streams && !r;
      if (!r) continue;
      const g = (k: string) => el.querySelector<HTMLElement>(`[data-g="${k}"]`)!;
      g('playing').hidden = !r.playing;
      g('playing').textContent = r.playing ? `${fmt(r.playing)}명 하는 중` : '';
      g('today').textContent = r.today !== undefined ? fmt(r.today) : '–';
      g('finished').textContent = r.finished !== undefined ? fmt(r.finished) : '–';
      g('todayBest').textContent = r.today && r.todayBest !== undefined ? r.unit(r.todayBest) : '–';
      const hasBest = !!r.best && r.best > 0;
      g('bar').hidden = !hasBest;
      g('bar').querySelector('i')!.style.width = hasBest ? `${Math.min(100, ((r.today ? r.todayBest ?? 0 : 0) / r.best!) * 100)}%` : '0';
      g('best').textContent = hasBest ? `역대 ${r.unit(r.best!)}` : '';
      el.title = hasBest ? '막대: 오늘 최고가 역대 최고의 몇 % 인지' : '';
    }

    // 연결 상태 + 지금 하는 사람
    const playing = (aim?.playing ?? 0) + (sOn('tiles') ? streams!.playing ?? 0 : 0);
    const st = [sAim.state, sStreams.state];
    const state = st.includes('live') ? (st.includes('poll') ? 'poll' : 'live') : st.includes('poll') ? 'poll' : 'wait';
    const status = $('[data-status]')!;
    status.dataset.state = state;
    set('status', state === 'wait' ? '연결하는 중…' : `${state === 'live' ? '실시간' : '5초마다 새로고침'} · 지금 ${fmt(playing)}명 하는 중`);
  }

  function renderFeed() {
    const now = Date.now();
    const rows = feed.filter((e) => filter === 'all' || e.game === filter).slice(0, FEED_SHOW);
    const tbody = $('[data-feed]')!;
    if (!rows.length) {
      const g = filter === 'all' ? '' : `${gameOf(filter).title} 에서 `;
      tbody.innerHTML = `<tr class="empty"><td colspan="6">이 페이지를 연 뒤 ${g}시작하거나 끝난 판이 여기 실시간으로 올라와요.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((e) => {
      const g = gameOf(e.game);
      const status = e.best ? `<span class="badge rec">${ICON[e.kind]}오늘 최고 기록</span>` : `<span class="badge">${ICON[e.kind]}${KIND_TEXT[e.kind]}</span>`;
      const acts = `<span class="acts">${e.best ? `<a class="btn primary sm" href="${esc(g.url)}" title="나도 도전">PLAY</a>` : ''}<a class="btn sm icon" href="/stats/${g.id}/" aria-label="${esc(g.title)} 통계">${UP}</a></span>`;
      return `<tr class="${e.at > now - 1600 ? 'fresh' : ''}">
        <td class="when" data-at="${e.at}">${ago(now - e.at)}</td>
        <td><span class="gname"><i class="g" style="--g:${esc(g.accent)}"></i>${esc(g.title)}</span></td>
        <td class="n">${esc(e.record)}</td>
        <td>${status}</td>
        <td class="c-detail">${esc(e.detail)}</td>
        <td class="c-go">${acts}</td>
      </tr>`;
    }).join('');
  }

  function push(events: Event[]) {
    if (!events.length) return;
    feed = [...events.reverse(), ...feed].slice(0, FEED_KEEP);
    renderFeed();
  }

  const sStreams = subscribe<StreamsStats>('streams', (s) => {
    if (streams) push(streamsEvents(streams, s, Date.now()));
    streams = s;
    renderCards();
  }, () => renderCards());
  const sAim = subscribe<AimStats>('aimbooster', (s) => {
    if (aim) push(aimEvents(aim, s, Date.now()));
    aim = s;
    renderCards();
  }, () => renderCards());

  // 화면 폭이 바뀌면 차트를 그 폭으로 다시 그린다
  let frame = 0;
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderCards);
  });
  const board = $('.board');
  if (board) resize.observe(board);

  // "몇 초 전" 을 굴린다
  const tick = window.setInterval(() => {
    const now = Date.now();
    root.querySelectorAll<HTMLElement>('[data-at]').forEach((td) => (td.textContent = ago(now - Number(td.dataset.at))));
  }, 5000);

  // 소식 거르기 (실시간 소식 = 전체)
  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter as typeof filter;
    root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    renderFeed();
  }));

  // 선 · 칸 · 미터에 올리면 값을 보여 준다
  const tip = $('[data-tip]')!;
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
    sStreams.close();
    sAim.close();
    clearInterval(tick);
    resize.disconnect();
  }, { once: true });
}
