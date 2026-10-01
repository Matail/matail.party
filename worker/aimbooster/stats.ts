// AIMBOOSTER 실시간 집계 (Durable Object AimStatsHub 가 저장 · 방송, 계산은 여기). STREAMS stats.ts 와 같은 방식.
// 분포만 들고 있다: 생존 시간(0.5초 칸) · 명중률(1% 칸) · 반응 시간(판별 중앙값, 25ms 칸). 상위 % 는 이 분포로 계산 — D1 을 치지 않는다.
// 세는 판: 끝났고 의심 판이 아니고 에디터 테스트(unity-editor/…)가 아님 — D1 뷰 aim_clean_runs 와 같다.
import { dayOf, dayStartIso } from "../streams/stats.ts";

export const SURVIVAL_BIN_MS = 500;
export const SURVIVAL_BINS = 1201;   // 0 ~ 600초 + 그 위 한 칸
export const ACCURACY_BINS = 101;    // 0 ~ 100%
export const REACTION_BIN_MS = 25;
export const REACTION_BINS = 81;     // 0 ~ 2초 + 그 위 한 칸
export const MIN_RUNS = 30;          // 이만큼 쌓이기 전에는 상위 % 를 내지 않는다
const ACTIVE_MS = 30 * 60 * 1000;    // 30분 넘게 끝나지 않은 판은 "하는 중" 에서 뺀다
const MARKS = 2000;

export interface AimStats {
  day: string;
  started: number;
  finished: number;
  best: number;                      // 최고 생존 시간 (ms)
  todayFinished: number;
  todayBest: number;
  hits: number;
  shots: number;
  survival: number[];
  accuracy: number[];
  reaction: number[];
  active: Record<string, number>;    // 진행 중 run id → 시작 시각 (밖으로 내보내지 않음)
  marks: string[];                   // 이미 센 판 id — 같은 토큰을 두 번 보내도 한 번만 (밖으로 내보내지 않음)
}

export interface Finished {
  id: string;
  durationMs: number;
  hits: number;
  shots: number;
  reactionMedianMs: number | null;   // 맞힌 과녁이 없으면 null
}

export interface Rank { survivalTop: number | null; accuracyTop: number | null; runs: number }

export const counted = (client: string | null) => !(client ?? "").startsWith("unity-editor/");

const clampBin = (v: number, bins: number) => Math.min(bins - 1, Math.max(0, Math.floor(v)));
export const survivalBin = (ms: number) => clampBin(ms / SURVIVAL_BIN_MS, SURVIVAL_BINS);
export const accuracyBin = (hits: number, shots: number) => (shots === 0 ? 0 : clampBin((hits / shots) * 100, ACCURACY_BINS));
export const reactionBin = (ms: number) => clampBin(ms / REACTION_BIN_MS, REACTION_BINS);

export function emptyStats(now: number): AimStats {
  return {
    day: dayOf(now), started: 0, finished: 0, best: 0, todayFinished: 0, todayBest: 0, hits: 0, shots: 0,
    survival: Array(SURVIVAL_BINS).fill(0), accuracy: Array(ACCURACY_BINS).fill(0), reaction: Array(REACTION_BINS).fill(0),
    active: {}, marks: [],
  };
}

function rollDay(s: AimStats, now: number) {
  const d = dayOf(now);
  if (d !== s.day) Object.assign(s, { day: d, todayFinished: 0, todayBest: 0 });
}

export function applyStarted(s: AimStats, id: string, now: number) {
  rollDay(s, now);
  s.started++;
  s.active[id] = now;
}

/** 이미 센 판이면 true. 처음 보면 표시해 둔다 */
export function seen(s: AimStats, id: string): boolean {
  if (s.marks.includes(id)) return true;
  s.marks.push(id);
  if (s.marks.length > MARKS) s.marks.splice(0, s.marks.length - MARKS);
  return false;
}

/** "상위 n%": 나보다 나은 판 수 + 1 (나) 을 전체(나 포함)로 나눈 값, 1~100 정수. 판이 MIN_RUNS 보다 적으면 null */
function top(bins: number[], bin: number): number | null {
  const total = bins.reduce((a, b) => a + b, 0) + 1;
  if (total < MIN_RUNS) return null;
  let better = 0;
  for (let i = bin + 1; i < bins.length; i++) better += bins[i];
  return Math.min(100, Math.max(1, Math.ceil(((better + 1) / total) * 100)));
}

/** 지금 분포에서 이 기록이 상위 몇 % 인지 (분포에 더하지 않는다) */
export function rank(s: AimStats, durationMs: number, hits: number, shots: number): Rank {
  return { survivalTop: top(s.survival, survivalBin(durationMs)), accuracyTop: top(s.accuracy, accuracyBin(hits, shots)), runs: s.finished };
}

/** 끝난 판 하나를 분포에 더한다 (실시간 갱신과 D1 재계산이 같이 쓴다) */
function tally(s: AimStats, g: Finished) {
  s.finished++;
  s.best = Math.max(s.best, g.durationMs);
  s.hits += g.hits;
  s.shots += g.shots;
  s.survival[survivalBin(g.durationMs)]++;
  s.accuracy[accuracyBin(g.hits, g.shots)]++;
  if (g.reactionMedianMs !== null) s.reaction[reactionBin(g.reactionMedianMs)]++;
}

export function applyFinished(s: AimStats, g: Finished, now: number) {
  rollDay(s, now);
  tally(s, g);
  s.todayFinished++;
  s.todayBest = Math.max(s.todayBest, g.durationMs);
  delete s.active[g.id];
}

/** 밖으로 내보내는 모양: 진행 중 판 id 대신 개수만, 분포는 끝의 0 을 잘라서 */
export function publicView(s: AimStats, now: number) {
  for (const [id, t] of Object.entries(s.active)) if (now - t > ACTIVE_MS) delete s.active[id];
  const trim = (a: number[]) => a.slice(0, a.findLastIndex((v) => v > 0) + 1);
  return {
    day: s.day, updatedAt: now, playing: Object.keys(s.active).length,
    started: s.started, finished: s.finished, best: s.best, todayFinished: s.todayFinished, todayBest: s.todayBest,
    accuracyAll: s.shots === 0 ? 0 : s.hits / s.shots,
    survivalBinMs: SURVIVAL_BIN_MS, survival: trim(s.survival), accuracy: trim(s.accuracy),
    reactionBinMs: REACTION_BIN_MS, reaction: trim(s.reaction),
  };
}
export type PublicAimStats = ReturnType<typeof publicView>;

/** D1 원본에서 처음부터 다시 센다 (DO 가 처음 뜨거나 저장된 집계가 없을 때) */
export async function countFromD1(db: D1Database, now: number): Promise<AimStats> {
  const s = emptyStats(now);
  type Row = Record<string, number | string | null>;
  const [started, runs, today] = await db.batch<Row>([
    db.prepare(`SELECT count(*) AS n FROM aim_runs WHERE client IS NULL OR client NOT LIKE 'unity-editor/%'`),
    db.prepare(`SELECT duration_ms, hits, shots, reaction_med_ms FROM aim_clean_runs`),
    db.prepare(`SELECT count(*) AS n, coalesce(max(duration_ms), 0) AS best FROM aim_clean_runs WHERE finished_at >= ?`).bind(dayStartIso(now)),
  ]);
  s.started = Number(started.results[0]?.n ?? 0);
  for (const r of runs.results) {
    const hits = Number(r.hits);
    tally(s, { id: "", durationMs: Number(r.duration_ms), hits, shots: Number(r.shots), reactionMedianMs: hits > 0 ? Number(r.reaction_med_ms) : null });
  }
  s.todayFinished = Number(today.results[0]?.n ?? 0);
  s.todayBest = Number(today.results[0]?.best ?? 0);
  return s;
}
