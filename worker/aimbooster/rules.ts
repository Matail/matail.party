// AIMBOOSTER 규칙 (Unity 리포 Assets/Scripts/Core/Rules.cs · SpawnSequence.cs 의 시간 부분 이식).
// 과녁이 나오는 시각은 시드와 상관없이 규칙만으로 정해진다 — 서버는 버틴 시간만 보고 그동안 나온 과녁 수를 다시 셀 수 있다.
// Rules.Version 이 바뀌면 여기도 같이 고친다 (rules.test.ts 의 값은 Unity EditMode 테스트와 같은 값).

export const RULES_VERSION = 4;
export const LIVES = 3;
export const LEVEL_MS = 15_000;
export const FIRST_SPAWN_MS = 500;
const LINEAR_LEVELS = 10;
const LATE_RATIO = 0.85;
const INTERVAL = { start: 1100, end: 420, limit: 300 };
const LIFETIME = { start: 2800, end: 1700, limit: 1200 };

export const levelAt = (ms: number) => 1 + Math.floor(Math.max(0, ms) / LEVEL_MS);

function curve(c: { start: number; end: number; limit: number }, level: number): number {
  level = Math.max(1, level);
  if (level <= LINEAR_LEVELS) return c.start + ((c.end - c.start) * (level - 1)) / (LINEAR_LEVELS - 1);
  return c.limit + (c.end - c.limit) * Math.pow(LATE_RATIO, level - LINEAR_LEVELS);
}

export const spawnIntervalMs = (level: number) => curve(INTERVAL, level);
export const lifetimeMs = (level: number) => curve(LIFETIME, level);

/** untilMs 까지(미만) 과녁이 나오는 시각들. LEVEL 마다 시작 0.5초 뒤부터, LEVEL 이 끝나기 전까지만 */
export function spawnTimes(untilMs: number): number[] {
  const out: number[] = [];
  for (let at = FIRST_SPAWN_MS; at < untilMs; ) {
    out.push(at);
    const level = levelAt(at);
    at += spawnIntervalMs(level);
    const levelEnd = level * LEVEL_MS;
    if (at >= levelEnd) at = levelEnd + FIRST_SPAWN_MS;
  }
  return out;
}

/** 판이 가장 빨리 끝나는 시각: 아무것도 안 맞히면 세 번째 과녁이 사라질 때 (5.5초) */
export function shortestRunMs(): number {
  const third = spawnTimes(LEVEL_MS)[LIVES - 1];
  return third + lifetimeMs(levelAt(third));
}
