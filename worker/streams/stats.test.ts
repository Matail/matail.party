// stats.ts 집계 확인 (DO 없이 순수 함수만).
//   node worker/streams/stats.test.ts
import assert from "node:assert/strict";
import { applyFinished, applyFirst, applyStarted, binOf, counted, dayOf, dayStartIso, emptyStats, publicView, SLOTS } from "./stats.ts";

// 한국 날짜: UTC 15:00 = 다음날 00:00 KST
assert.equal(dayOf(Date.parse("2026-09-30T14:59:59Z")), "2026-09-30");
assert.equal(dayOf(Date.parse("2026-09-30T15:00:00Z")), "2026-10-01");
assert.equal(dayStartIso(Date.parse("2026-09-30T20:00:00Z")), "2026-09-30T15:00:00.000Z");

// 세는 판: AI 대전, 에디터·로컬 테스트 제외, 헤더 없는 옛 판은 센다
assert.equal(counted("web/1"), true);
assert.equal(counted(null), true);
assert.equal(counted("unity-editor/0.1.0"), false);
assert.equal(counted("web/1", "pvp"), false);
assert.deepEqual([0, 9, 10, 99, 100, 300].map(binOf), [0, 0, 1, 9, 10, 10]);

const t0 = Date.parse("2026-09-30T10:00:00Z");
const s = emptyStats(t0);
applyStarted(s, "g1", t0);
applyStarted(s, "g2", t0);
applyFirst(s, 15, 9, "g1");
applyFirst(s, 15, 9, "g1");                       // 같은 판 첫 수를 다시 보냄 → 한 번만
assert.equal(s.heat[14 * SLOTS + 9], 1);
applyFinished(s, { id: "g1", level: 3, me: 42, ai: 39, client: "unity-webgl/0.1.0" }, t0 + 60_000);
applyFinished(s, { id: "g1", level: 3, me: 42, ai: 39, client: "unity-webgl/0.1.0" }, t0 + 61_000); // 다시 보냄 → 무시
applyFinished(s, { id: "g2", level: 3, me: 30, ai: 30, client: "web/1" }, t0 + 62_000);
assert.equal(s.finished, 2);
assert.equal(s.won, 1);
assert.equal(s.drawn, 1);
assert.deepEqual(s.levels[2], { games: 2, won: 1, drawn: 1, me: 72, ai: 69 });
assert.equal(s.bins[4], 1);
assert.equal(s.bins[3], 1);
assert.equal(s.best, 42);

// 공개 모양: 판 id 가 새지 않고 진행 중은 개수만, 판 하나하나(최근 판)·클라이언트 비율은 없음 (관리자 전용)
applyStarted(s, "g3", t0);
const view = publicView(s, t0 + 70_000);
assert.equal(view.playing, 1);
assert.equal("active" in view || "marks" in view || "recent" in view || "clients" in view, false);
assert.equal(JSON.stringify(view).includes("g3"), false);
assert.equal(publicView(s, t0 + 31 * 60_000).playing, 0); // 30분 넘은 판은 빠진다
assert.deepEqual(view.cards, ["tiles", "funnel", "bins", "radar", "gauge", "heat"]); // 기본은 전부
assert.equal(view.best, 42);                     // 역대 최고 점수는 요약 칸(tiles)과 같이 나간다 (통계 탭 개요)

// 관리자가 끈 카드의 값은 공개 응답에서도 빠진다 (다른 켜진 카드가 쓰는 값은 남는다)
const some = publicView(s, t0, ["radar", "heat"]);
assert.deepEqual(some.cards, ["radar", "heat"]);
assert.ok(some.levels && some.heat);
assert.equal("bins" in some || "won" in some || "playing" in some || "started" in some || "best" in some, false);
const none = publicView(s, t0, []);
assert.deepEqual(Object.keys(none).sort(), ["cards", "day", "updatedAt"]);

// 날짜가 바뀌면 "오늘" 이 비워진다
applyStarted(s, "g4", Date.parse("2026-09-30T16:00:00Z"));
assert.equal(s.day, "2026-10-01");
assert.equal(s.todayStarted, 1);
assert.equal(s.todayFinished, 0);

console.log("stats.test: ok");
