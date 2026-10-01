// AIMBOOSTER 실시간 통계 페이지 (src/pages/stats/aimbooster.astro).
// 웹소켓(/api/aimbooster/live)으로 스냅숏을 받아 SVG 로 다시 그린다. 끊기면 5초마다 /api/aimbooster/stats 를 받고 다시 붙는다.
// "내 위치": 게임(WebGL)이 판이 끝날 때마다 localStorage["aimbooster-me"] 에 이 브라우저 기록 요약을 둔다
// (aimbooster-unity SiteBridge). 있으면 분포 위에 표시하고 /api/aimbooster/rank 로 상위 % 를 묻는다 — 게임 안 통계 창과 같은 값.
// 색은 STREAMS 페이지와 같은 역할 색: 단일 계열 #22ab9b · 나 #3987e5 (어두운 카드 #16161c 기준).

interface Stats {
  playing: number; started: number; finished: number; best: number; todayFinished: number; todayBest: number;
  accuracyAll: number;
  survivalBinMs: number; survival: number[];   // 끝의 0 은 잘려서 온다
  accuracy: number[];                           // 1% 칸 (0 ~ 100)
  reactionBinMs: number; reaction: number[];    // 판별 반응 시간 중앙값
}
interface Me { bestMs: number; hits: number; shots: number; runs: number }
interface Rank { survivalTop: number | null; accuracyTop: number | null; runs: number }

const C = { teal: '#22ab9b', me: '#3987e5', track: 'rgba(255,255,255,0.05)' };
const SURVIVAL_MIN_SEC = 60;            // 판이 적어도 1분까지는 그린다
const SURVIVAL_STEPS = [5, 10, 15, 30, 60, 120];
const MAX_BARS = 24;
const ACC_STEP = 5;                     // %
const REACTION_STEP_MS = 50, REACTION_MAX_MS = 1000;

const fmt = (n: number) => n.toLocaleString('ko-KR');
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const svg = (w: number, h: number, body: string) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** 한 발도 안 쐈으면 0% — 게임(RunSummary.Accuracy)과 서버(accuracyBin) 와 같다 */
const accuracyOf = (me: Me) => (me.shots ? me.hits / me.shots : 0);

/** 칸 n 개씩 묶는다. 길이 len 까지 0 으로 채운다 */
const group = (a: number[], n: number, len: number) =>
  Array.from({ length: len }, (_, i) => sum(a.slice(i * n, (i + 1) * n)));

/** 누적이 절반을 넘는 칸 (없으면 -1) */
function medianBin(a: number[]) {
  const half = sum(a) / 2;
  let acc = 0;
  for (let i = 0; i < a.length; i++) if ((acc += a[i]) >= half && half > 0) return i;
  return -1;
}

// ── 차트 ─────────────────────────────────────────────────────────

interface Bars {
  counts: number[];
  label: (i: number) => string;   // 막대 아래 글자 (빈 문자열이면 생략)
  tip: (i: number) => string;     // 올렸을 때 보이는 범위
  me?: number;                    // 내 값의 위치 (막대 단위, 0 = 첫 막대 왼쪽 끝)
}

/** 분포: 트랙 위에 둥근 막대, 내 위치는 파란 세로줄 */
function bars({ counts, label, tip, me }: Bars) {
  const W = 440, H = 170, top = 24, base = 140, n = counts.length, slot = W / n, bw = Math.max(4, Math.min(26, slot - 6));
  const max = Math.max(1, ...counts);
  let body = '';
  counts.forEach((v, i) => {
    const x = i * slot + (slot - bw) / 2, h = (v / max) * (base - top);
    const text = label(i);
    body += `<g data-t="${tip(i)} · ${fmt(v)}판">
      <rect x="${x}" y="${top}" width="${bw}" height="${base - top}" rx="${Math.min(6, bw / 2)}" fill="${C.track}"/>
      ${v > 0 ? `<rect x="${x}" y="${base - Math.max(h, 6)}" width="${bw}" height="${Math.max(h, 6)}" rx="${Math.min(6, bw / 2)}" fill="${C.teal}"/>` : ''}
      ${text ? `<text x="${x + bw / 2}" y="${base + 18}" text-anchor="middle">${text}</text>` : ''}
    </g>`;
  });
  if (me !== undefined) {
    const x = Math.min(W - 1, Math.max(1, me * slot)), px = Math.min(W - 14, Math.max(14, x));
    body += `<g pointer-events="none">
      <line x1="${x}" y1="${top - 2}" x2="${x}" y2="${base}" stroke="${C.me}" stroke-width="2"/>
      <rect x="${px - 14}" y="${top - 20}" width="28" height="18" rx="9" fill="${C.me}"/>
      <text x="${px}" y="${top - 7}" text-anchor="middle" style="fill:#fff;font-size:12px;font-weight:700">나</text>
    </g>`;
  }
  return svg(W, H, body);
}

/** 버틴 시간: 0.5초 칸을 5 · 10 · 15 · 30 · 60 · 120초로 묶어 막대 24개 이하로 */
function survivalChart(s: Stats, me: Me | null) {
  const binsPerSec = 1000 / s.survivalBinMs;
  const span = Math.max(s.survival.length, SURVIVAL_MIN_SEC * binsPerSec, me ? Math.floor(me.bestMs / s.survivalBinMs) + 1 : 0);
  const step = SURVIVAL_STEPS.find((t) => Math.ceil(span / (t * binsPerSec)) <= MAX_BARS) ?? SURVIVAL_STEPS.at(-1)!;
  const per = step * binsPerSec, n = Math.ceil(span / per);
  const every = n > 12 ? 2 : 1;
  return bars({
    counts: group(s.survival, per, n),
    label: (i) => (i % every === 0 ? String(i * step) : ''),
    tip: (i) => `${i * step}~${(i + 1) * step}초`,
    me: me ? me.bestMs / 1000 / step : undefined,
  });
}

/** 판별 명중률: 1% 칸을 5% 로 (100% 는 마지막 막대에) */
function accuracyChart(s: Stats, me: Me | null) {
  const acc = Array.from({ length: 101 }, (_, i) => s.accuracy[i] ?? 0);
  acc[99] += acc[100];
  const n = 100 / ACC_STEP;
  return bars({
    counts: group(acc.slice(0, 100), ACC_STEP, n),
    label: (i) => (i % 2 === 0 ? String(i * ACC_STEP) : ''),
    tip: (i) => (i === n - 1 ? `${i * ACC_STEP}~100%` : `${i * ACC_STEP}~${i * ACC_STEP + ACC_STEP - 1}%`),
    me: me ? accuracyOf(me) * n : undefined,
  });
}

/** 반응 시간(판별 중앙값): 25ms 칸을 50ms 로, 1초 넘는 판은 마지막 막대에 */
function reactionChart(s: Stats) {
  const per = REACTION_STEP_MS / s.reactionBinMs, n = REACTION_MAX_MS / REACTION_STEP_MS;
  const counts = group(s.reaction, per, n);
  counts[n - 1] += sum(s.reaction.slice(n * per));
  return bars({
    counts,
    label: (i) => (i % 4 === 0 ? String(i * REACTION_STEP_MS) : ''),
    tip: (i) => (i === n - 1 ? `${i * REACTION_STEP_MS}ms 이상` : `${i * REACTION_STEP_MS}~${(i + 1) * REACTION_STEP_MS}ms`),
  });
}

// ── 그리기 ───────────────────────────────────────────────────────

function readMe(): Me | null {
  try {
    const m = JSON.parse(localStorage.getItem('aimbooster-me') ?? 'null');
    const ok = m && [m.bestMs, m.hits, m.shots, m.runs].every((v) => Number.isInteger(v) && v >= 0) && m.runs > 0;
    return ok ? m : null;
  } catch {
    return null;
  }
}

function render(root: HTMLElement, s: Stats, me: Me | null) {
  const set = (k: string, v: string) => root.querySelectorAll(`[data-v="${k}"]`).forEach((e) => (e.textContent = v));
  const put = (sel: string, html: string) => { const e = root.querySelector(sel); if (e) e.innerHTML = html; };

  set('playing', fmt(s.playing));
  set('todayFinished', fmt(s.todayFinished));
  set('todayBest', s.todayFinished ? sec(s.todayBest) : '–');
  set('finished', fmt(s.finished));

  const sm = medianBin(s.survival);
  set('survivalMedian', sm < 0 ? '–' : ((sm + 0.5) * s.survivalBinMs / 1000).toFixed(1));
  put('[data-chart="survival"]', survivalChart(s, me));
  put('[data-stats="survival"]', [['최고 기록', s.finished ? sec(s.best) : '–'], ['끝난 판', fmt(s.finished)]]
    .map(([t, v]) => `<div class="st">${t}<b>${v}</b></div>`).join(''));

  set('accuracyAll', s.finished ? String(Math.round(s.accuracyAll * 100)) : '–');
  put('[data-chart="accuracy"]', accuracyChart(s, me));

  const rm = medianBin(s.reaction);
  set('reactionMedian', rm < 0 ? '–' : String(Math.round((rm + 0.5) * s.reactionBinMs)));
  put('[data-chart="reaction"]', reactionChart(s));
}

/** 내 위치 카드: 이 브라우저 기록 + 상위 % */
function renderMe(root: HTMLElement, me: Me | null, rank: Rank | null) {
  const box = root.querySelector<HTMLElement>('[data-me]');
  if (!box) return;
  if (!me) {
    box.innerHTML = `<p class="me-empty">이 브라우저에서 한 판 하면, 내 최고 기록과 명중률이 사람들 중 어디쯤인지 여기와 분포에 표시돼요.
      <a href="/games/aimbooster/">게임 하러 가기 →</a></p>`;
    return;
  }
  const top = (v: number | null | undefined) => (v ? `상위 ${v}%` : rank ? '판이 더 쌓이면 나와요' : '…');
  box.innerHTML = `
    <div class="me-item"><span class="t-label">내 최고 기록</span><span class="t-value">${sec(me.bestMs)}</span><span class="me-top">${top(rank?.survivalTop)}</span></div>
    <div class="me-item"><span class="t-label">내 명중률</span><span class="t-value">${Math.round(accuracyOf(me) * 100)}%</span><span class="me-top">${top(rank?.accuracyTop)}</span></div>
    <p class="me-note">이 브라우저 기록 ${fmt(me.runs)}판 기준${rank ? ` · 전체 ${fmt(rank.runs)}판과 비교` : ''}</p>`;
}

// ── 연결 ─────────────────────────────────────────────────────────

export function startLive(root: HTMLElement) {
  if (root.dataset.started) return;
  root.dataset.started = '1';

  const me = readMe();
  renderMe(root, me, null);
  if (me) {
    fetch(`/api/aimbooster/rank?durationMs=${me.bestMs}&hits=${me.hits}&shots=${me.shots}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: Rank | null) => r && renderMe(root, me, r))
      .catch(() => {});
  }

  let ws: WebSocket | null = null, poll = 0, retry = 0, backoff = 5000, closed = false;

  const fetchOnce = () => fetch('/api/aimbooster/stats').then((r) => r.json()).then((s: Stats) => render(root, s, me)).catch(() => {});

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/aimbooster/live`);
    ws.onopen = () => {
      backoff = 5000;
      clearInterval(poll);
    };
    ws.onmessage = (e) => render(root, JSON.parse(e.data), me);
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

  // 막대에 올리면 값을 보여 준다
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
