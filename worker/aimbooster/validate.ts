// 끝난 판 요약 검사 (docs/aimbooster-api.md "검증"). 판정은 클라이언트가 하므로 서버는 "규칙상 가능한 판인가"만 본다.
// 걸린 사유는 지우지 않고 기록한다 — 의심 판(suspect)은 저장하되 공개 집계 · 상위 % 에서만 뺀다.
import { levelAt, LIVES, lifetimeMs, RULES_VERSION, shortestRunMs, spawnTimes } from "./rules.ts";

export const WALLS = 3;
export const SLACK_MS = 2000;          // 서버 시계와 판 시계 차이 (요청 왕복 등)
export const MIN_HUMAN_MEDIAN_MS = 120;  // 판 하나 반응 시간 중앙값이 이보다 빠르면 사람이 아니다
const MAX_REACTIONS = 5000;

/** Unity RunSummary (JsonUtility) 와 같은 모양 */
export interface Summary {
  rulesVersion: number;
  seed: number;
  durationMs: number;
  shots: number;
  hits: number;
  misses: number;
  spawned: number;
  maxLevel: number;
  reactionsMs: number[];
  wallHits: number[];
  wallMisses: number[];
}

const nat = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const nats = (v: unknown, len?: number): v is number[] => Array.isArray(v) && (len === undefined || v.length === len) && v.every(nat);

/** 모양만 본다 (정수 · 배열 길이). 틀리면 오류 문자열 */
export function parseSummary(body: unknown): Summary | string {
  if (typeof body !== "object" || body === null) return "invalid summary";
  const s = body as Record<string, unknown>;
  for (const k of ["rulesVersion", "seed", "durationMs", "shots", "hits", "misses", "spawned", "maxLevel"]) {
    if (!nat(s[k])) return `invalid ${k}`;
  }
  if (!nats(s.reactionsMs) || (s.reactionsMs as number[]).length > MAX_REACTIONS) return "invalid reactionsMs";
  if (!nats(s.wallHits, WALLS)) return "invalid wallHits";
  if (!nats(s.wallMisses, WALLS)) return "invalid wallMisses";
  return s as unknown as Summary;
}

/** nearest-rank 백분위 (Unity RunSummary 와 같은 방식). 없으면 0 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** 규칙상 불가능한 점을 사유로 돌려준다 (빈 배열이면 통과). elapsedMs: 서버가 잰 /start 부터 지금까지 */
export function check(s: Summary, elapsedMs: number): string[] {
  const why: string[] = [];
  const t = s.durationMs;
  if (s.rulesVersion !== RULES_VERSION) why.push("rules version");
  if (t > elapsedMs + SLACK_MS) why.push("longer than real time");
  if (t < shortestRunMs() - 1) why.push("shorter than possible");
  if (s.misses !== LIVES) why.push("must end with 3 misses");

  // 나온 과녁 수는 버틴 시간으로 정해진다. durationMs 는 반올림된 값이라 앞뒤 1ms 를 봐 준다
  const fewest = spawnTimes(t - 1).length, most = spawnTimes(t + 1.001).length;
  if (s.spawned < fewest || s.spawned > most) why.push("spawn count");
  if (s.maxLevel < levelAt(t - 1) || s.maxLevel > levelAt(t + 1)) why.push("level");

  if (s.hits + s.misses > s.spawned) why.push("more targets than spawned");
  if (s.hits > s.shots) why.push("more hits than shots");
  if (s.reactionsMs.length !== s.hits) why.push("reaction count");
  if (s.reactionsMs.some((r) => r > lifetimeMs(1) + 50)) why.push("reaction longer than lifetime");
  if (s.hits >= 5 && percentile(s.reactionsMs, 0.5) < MIN_HUMAN_MEDIAN_MS) why.push("inhuman reactions");
  if (sum(s.wallHits) !== s.hits || sum(s.wallMisses) !== s.misses) why.push("wall totals");
  return why;
}
