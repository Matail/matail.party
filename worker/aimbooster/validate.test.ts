// validate.ts 검사와 token.ts 봉인 확인.
//   node worker/aimbooster/validate.test.ts
import assert from "node:assert/strict";
import { spawnTimes } from "./rules.ts";
import { open, seal } from "./token.ts";
import { check, parseSummary, percentile, type Summary } from "./validate.ts";

// 한 발도 안 쏜 판 (5.5초)
const idle: Summary = {
  rulesVersion: 4, seed: 7, durationMs: 5500, shots: 0, hits: 0, misses: 3, spawned: 5, maxLevel: 1,
  reactionsMs: [], wallHits: [0, 0, 0], wallMisses: [1, 1, 1],
};
assert.deepEqual(check(idle, 9000), []);

// 20초 버틴 판: LEVEL 1 에서 14개, LEVEL 2 에서 5개 (15.5 · 16.52 · 17.55 · 18.57 · 19.60초) = 19개
assert.equal(spawnTimes(20_000).length, 19);
const good: Summary = {
  rulesVersion: 4, seed: 7, durationMs: 20_000, shots: 20, hits: 16, misses: 3, spawned: 19, maxLevel: 2,
  reactionsMs: Array(16).fill(300), wallHits: [4, 8, 4], wallMisses: [1, 1, 1],
};
assert.deepEqual(check(good, 30_000), []);

const with_ = (patch: Partial<Summary>) => ({ ...good, ...patch });
assert.deepEqual(check(good, 15_000), ["longer than real time"]);                  // 15초 전에 시작한 판이 20초를 버텼다
assert.deepEqual(check(with_({ spawned: 25 }), 30_000), ["spawn count"]);
assert.deepEqual(check(with_({ maxLevel: 5 }), 30_000), ["level"]);
assert.deepEqual(check(with_({ misses: 2, wallMisses: [1, 1, 0] }), 30_000), ["must end with 3 misses"]);
assert.deepEqual(check(with_({ hits: 17, reactionsMs: Array(17).fill(300), wallHits: [5, 8, 4] }), 30_000), ["more targets than spawned"]);
assert.deepEqual(check(with_({ shots: 10 }), 30_000), ["more hits than shots"]);
assert.deepEqual(check(with_({ reactionsMs: Array(16).fill(50) }), 30_000), ["inhuman reactions"]);
assert.deepEqual(check(with_({ reactionsMs: [...Array(15).fill(300), 5000] }), 30_000), ["reaction longer than lifetime"]);
assert.deepEqual(check(with_({ wallHits: [0, 0, 0] }), 30_000), ["wall totals"]);
assert.deepEqual(check(with_({ rulesVersion: 3 }), 30_000), ["rules version"]);
assert.ok(check(with_({ durationMs: 3000, spawned: 3, maxLevel: 1 }), 30_000).includes("shorter than possible"));

// durationMs 는 반올림 값이라 경계에서 1ms 를 봐 준다: 14.8초에 나온 과녁을 14,800 · 14,801 ms 에 끝난 판 모두 받아들인다
assert.equal(spawnTimes(14_800).length, 13);
assert.equal(spawnTimes(14_801).length, 14);

// 모양 검사
assert.equal(parseSummary({ ...good, hits: -1 }), "invalid hits");
assert.equal(parseSummary({ ...good, wallHits: [1, 2] }), "invalid wallHits");
assert.equal(parseSummary({ ...good, reactionsMs: "x" }), "invalid reactionsMs");
assert.equal(parseSummary(null), "invalid summary");
assert.deepEqual(parseSummary(good), good);

// nearest-rank 백분위 (Unity RunSummary 와 같다)
assert.equal(percentile([500, 100, 300, 200, 400, 600, 700, 800, 900, 1000], 0.5), 500);
assert.equal(percentile([500, 100, 300, 200, 400, 600, 700, 800, 900, 1000], 0.9), 900);
assert.equal(percentile([], 0.5), 0);

// 토큰: 봉인한 값을 그대로 열고, 바꾸거나 다른 키면 열리지 않는다
const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const token = await seal({ id: "abc", seed: 7, at: 123, rv: 4 }, key);
assert.deepEqual(await open(token, key), { id: "abc", seed: 7, at: 123, rv: 4 });
assert.equal(await open(token.slice(0, -2) + (token.endsWith("A") ? "B" : "A") + token.slice(-1), key), null);
assert.equal(await open(token, other), null);
assert.equal(await open("garbage", key), null);

console.log("validate ok");
