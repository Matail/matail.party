// stats.ts 집계 · 상위 % 확인 (DO 없이 순수 함수만).
//   node worker/aimbooster/stats.test.ts
import assert from "node:assert/strict";
import { accuracyBin, applyFinished, applyStarted, counted, emptyStats, MIN_RUNS, publicView, rank, seen, survivalBin } from "./stats.ts";

assert.equal(counted("unity-webgl/0.1.0"), true);
assert.equal(counted(null), true);
assert.equal(counted("unity-editor/0.1.0"), false);
assert.deepEqual([0, 499, 500, 35_200, 600_000, 9_999_999].map(survivalBin), [0, 0, 1, 70, 1200, 1200]);
assert.deepEqual([[0, 0], [1, 3], [3, 4], [10, 10]].map(([h, s]) => accuracyBin(h, s)), [0, 33, 75, 100]);

const t0 = Date.parse("2026-10-02T03:00:00Z");
const s = emptyStats(t0);

// 판이 적으면 상위 % 를 내지 않는다
assert.deepEqual(rank(s, 10_000, 5, 10), { survivalTop: null, accuracyTop: null, runs: 0 });

// 1초 ~ 40초 버틴 판 40개, 명중률은 i% (i = 1..40)
for (let i = 1; i <= 40; i++) {
  applyStarted(s, `r${i}`, t0);
  applyFinished(s, { id: `r${i}`, durationMs: i * 1000, hits: i, shots: 100, reactionMedianMs: i % 2 ? 300 : null }, t0);
}
assert.equal(s.finished, 40);
assert.equal(s.best, 40_000);
assert.equal(s.todayFinished, 40);

// 35.2초: 더 오래 버틴 판은 36~40초 다섯 → (5 + 1) / 41 = 14.6% → 상위 15%
// 명중률 20%: 더 높은 판은 21~40% 스무 개 → (20 + 1) / 41 = 51.2% → 상위 52%
assert.deepEqual(rank(s, 35_200, 20, 100), { survivalTop: 15, accuracyTop: 52, runs: 40 });
// 1등이어도 0% 가 되지 않는다: (0 + 1) / 41 = 2.4% → 상위 3%. 꼴찌면 100%
assert.equal(rank(s, 99_000, 100, 100).survivalTop, 3);
assert.equal(rank(s, 0, 0, 0).survivalTop, 100);
assert.ok(MIN_RUNS <= 41);

// 같은 판은 한 번만
assert.equal(seen(s, "x1"), false);
assert.equal(seen(s, "x1"), true);

// 공개 모양: 진행 중 id · 표시 목록은 나가지 않고, 분포는 끝의 0 을 자른다
const v = publicView(s, t0);
assert.equal(v.playing, 0);
assert.equal(v.finished, 40);
assert.equal(v.survival.length, survivalBin(40_000) + 1);
assert.equal(v.accuracy.length, 41);
assert.equal(v.reaction.length, 13);           // 300ms 칸(12)까지
assert.equal(v.reaction[12], 20);              // 홀수 판 20개만 반응 시간이 있다
assert.ok(!("marks" in v) && !("active" in v));
assert.equal(v.accuracyAll, (40 * 41) / 2 / 4000);

console.log("stats ok");
