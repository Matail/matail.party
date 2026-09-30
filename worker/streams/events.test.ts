// events.ts 입력 검사 확인.
//   node worker/streams/events.test.ts
import assert from "node:assert/strict";
import { MAX_DATA, MAX_EVENTS, parseEvents, type EventBatch } from "./events.ts";

const ok = (body: unknown) => {
  const r = parseEvents(body);
  assert.equal(typeof r, "object", `expected batch, got ${r}`);
  return r as EventBatch;
};

// 묶음 자체가 틀리면 오류
assert.equal(parseEvents(null), "invalid body");
assert.equal(parseEvents({}), "events must be an array");
assert.equal(parseEvents({ events: Array(MAX_EVENTS + 1).fill({ seq: 0, type: "hover" }) }), `at most ${MAX_EVENTS} events`);

// Unity 모양: data 는 JSON 문자열
const unity = ok({
  sessionId: "0b6e2f1a-1111-2222-3333-444455556666",
  playerId: "p-1",
  events: [{ gameId: "a1b2c3d4e5f6a1b2c3d4e5f6", seq: 3, type: "hover", ts: 1790000000000.4, data: '{"turn":2,"slot":7,"ms":640}' }],
});
assert.equal(unity.sessionId, "0b6e2f1a-1111-2222-3333-444455556666");
assert.deepEqual(unity.rows, [{ gameId: "a1b2c3d4e5f6a1b2c3d4e5f6", seq: 3, type: "hover", data: '{"turn":2,"slot":7,"ms":640}', clientTs: 1790000000000 }]);

// 웹 모양: data 는 객체, gameId·ts 는 없어도 된다. 빈 문자열 data(Unity 기본값)는 null
const web = ok({ events: [{ seq: 0, type: "session_start", data: { w: 1920 } }, { seq: 1, type: "rematch", data: "" }] });
assert.equal(web.sessionId, null);
assert.deepEqual(web.rows.map((r) => [r.type, r.data, r.gameId, r.clientTs]), [["session_start", '{"w":1920}', null, null], ["rematch", null, null, null]]);

// 형식이 틀린 이벤트는 그것만 버린다
const mixed = ok({
  sessionId: "bad id!",
  events: [
    { seq: 0, type: "Hover" },                    // 대문자
    { seq: -1, type: "hover" },                   // 음수 순번
    { seq: 1.5, type: "hover" },                  // 정수 아님
    { seq: 2, type: "hover", data: "{not json" }, // 깨진 JSON
    { seq: 3, type: "hover", data: "x".repeat(10) },
    { seq: 4, type: "hover", data: { s: "x".repeat(MAX_DATA) } }, // 너무 김
    { seq: 5, type: "abandon", gameId: "../../etc" },             // 이상한 id 는 null 로
    "not an object",
  ],
});
assert.equal(mixed.sessionId, null);
assert.deepEqual(mixed.rows.map((r) => [r.seq, r.type, r.gameId]), [[5, "abandon", null]]);

console.log("events.test: ok");
