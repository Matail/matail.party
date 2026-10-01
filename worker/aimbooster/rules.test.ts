// rules.ts 가 Unity 규칙(Rules.cs · SpawnSequence.cs)과 같은 값을 내는지. 값은 Unity EditMode 테스트와 같다.
//   node worker/aimbooster/rules.test.ts
import assert from "node:assert/strict";
import { levelAt, lifetimeMs, RULES_VERSION, shortestRunMs, spawnIntervalMs, spawnTimes } from "./rules.ts";

assert.equal(RULES_VERSION, 4);

// LEVEL 은 15초마다, 상한 없음
assert.deepEqual([0, 14_999, 15_000, 134_999, 135_000, 285_000, 600_000, -5].map(levelAt), [1, 1, 2, 9, 10, 20, 41, 1]);

// 선형 구간 끝 값과 그 뒤 (한계와의 차이를 85% 씩)
assert.equal(spawnIntervalMs(1), 1100);
assert.equal(spawnIntervalMs(10), 420);
assert.equal(spawnIntervalMs(11), 300 + 120 * 0.85);
assert.equal(lifetimeMs(1), 2800);
assert.equal(lifetimeMs(11), 1200 + 500 * 0.85);
assert.ok(Math.abs(spawnIntervalMs(30) - 300) < 300 * 0.02);

// 한 발도 안 쏘면: 0.5 · 1.6 · 2.7 · 3.8 · 4.9 초에 나오고 5.5초에 세 번째가 사라져 끝 (Unity NoShotsEndsAtThirdExpiry)
assert.deepEqual(spawnTimes(5600), [500, 1600, 2700, 3800, 4900]);
assert.equal(shortestRunMs(), 5500);

// LEVEL 1 마지막 과녁 14.8초, LEVEL 2 첫 과녁 15.5초 (Unity LevelClearRemovesTargetsWithoutMiss)
const t = spawnTimes(16_000);
assert.equal(t.length, 15);
assert.ok(Math.abs(t[13] - 14_800) < 1e-6);
assert.equal(t[14], 15_500);
// 모든 과녁은 자기 LEVEL 안에서 나온다
for (const at of spawnTimes(200_000)) {
  const start = (levelAt(at) - 1) * 15_000;
  assert.ok(at >= start + 500 && at < start + 15_000, `spawn ${at}`);
}

console.log("rules ok");
