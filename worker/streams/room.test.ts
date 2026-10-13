// room.ts 방 규칙 확인 (DO 없이 순수 함수만).
//   node worker/streams/room.test.ts
import assert from "node:assert/strict";
import { N, score } from "./game.ts";
import {
  addSeat, cleanName, connect, disconnect, DROP_MS, EMPTY_MS, expired, handle, newRoom, nextAlarm, normCode,
  parseClient, seatByToken, stateFor, tick, TURN_MS, type ClientMsg, type Deps, type Out, type Room,
} from "./room.ts";

// 덱은 고정, AI 는 왼쪽 첫 빈칸
const DECK = [5, 12, 30, 1, 18, 18, 7, 22, 3, 15, 11, 26, 9, 14, 20, 2, 13, 29, 16, 8];
let now = 1_000_000;
const deps = (): Deps => ({ now, choose: (b) => b.indexOf(0), newDeck: () => [...DECK] });

const msgs = (out: Out[], t: string) => out.filter((o) => o.msg?.t === t).map((o) => o.msg!);
const send = (room: Room, seat: number, m: ClientMsg) => handle(room, seat, m, deps());
const place = (room: Room, seat: number, slot: number) => send(room, seat, { t: "place", turn: room.turn, slot, thinkMs: 1000 });
const errCode = (out: Out[]) => msgs(out, "error")[0]?.code;

/** n 명이 들어와 연결된 방 (자리 0 이 방장) */
function lobby(n: number): Room {
  const room = newRoom("K7QM2X", now);
  for (let i = 0; i < n; i++) {
    const s = addSeat(room, `p${i}`, `pid${i}`, `tok${i}`, now);
    assert.ok(typeof s === "object");
    connect(room, s.seat, deps());
  }
  return room;
}

// ── 입력 검사 ──
assert.equal(cleanName("  철수 "), "철수");
assert.equal(cleanName("a\u0000b"), "ab");
assert.equal(cleanName("   "), null);
assert.equal(cleanName("가나다라마바사아자차카타"), "가나다라마바사아자차카타"); // 12자
assert.equal(cleanName("가나다라마바사아자차카타파"), null);
assert.equal(cleanName(7), null);
assert.equal(normCode("k7qm2x"), "K7QM2X");
assert.equal(normCode("K7QM2O"), null); // O 는 안 쓰는 글자
assert.equal(normCode("K7QM2"), null);
assert.deepEqual(parseClient('{"t":"place","turn":3,"slot":4,"thinkMs":1234.6}'), { t: "place", turn: 3, slot: 4, thinkMs: 1235 });
assert.deepEqual(parseClient('{"t":"place","turn":3,"slot":4}'), { t: "place", turn: 3, slot: 4, thinkMs: null });
assert.equal(parseClient('{"t":"place","turn":3,"slot":"4"}'), null);
assert.equal(parseClient('{"t":"hello"}'), null); // hello 는 DO 가 따로
assert.equal(parseClient("ping"), null);
assert.equal(parseClient("null"), null);

// ── 자리 ──
{
  const room = lobby(8);
  assert.equal(addSeat(room, "x", null, "tokx", now), "room full");
  assert.deepEqual(room.seats.map((s) => s.seat), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seatByToken(room, "tok3")?.seat, 3);
  // 대기실에서 나가면 자리가 비고, 빈 번호를 다시 쓴다
  const out = send(room, 3, { t: "leave" });
  assert.deepEqual(out[0], { to: 3, close: 1000 });
  assert.equal(room.seats.length, 7);
  const s = addSeat(room, "y", null, "toky", now);
  assert.ok(typeof s === "object" && s.seat === 3);
}

// ── 시작 ──
{
  const room = lobby(3);
  assert.equal(errCode(send(room, 1, { t: "start" })), "not_host");
  disconnect(room, 1, deps());
  disconnect(room, 2, deps());
  assert.equal(errCode(send(room, 0, { t: "start" })), "need_players");
  connect(room, 1, deps());
  const out = send(room, 0, { t: "start" });
  // 시작할 때 연결 안 된 자리(2)는 빠진다
  assert.deepEqual(room.seats.map((s) => s.seat), [0, 1]);
  assert.equal(room.phase, "playing");
  assert.deepEqual(msgs(out, "card"), [{ t: "card", turn: 0, card: 5, timeLeftMs: TURN_MS }]);
  assert.equal(addSeat(room, "late", null, "tokl", now), "game in progress");
  assert.equal(errCode(send(room, 0, { t: "start" })), "bad_phase");
}

// ── 8명 한 판 ──
{
  const room = lobby(8);
  send(room, 0, { t: "start" });
  let finished: Record<string, unknown> | undefined;
  for (let turn = 0; turn < N; turn++) {
    for (let seat = 0; seat < 8; seat++) {
      // 자리마다 다른 칸 순서: seat 만큼 돌린 위치에서 오른쪽으로 첫 빈칸
      const board = room.seats[seat].board;
      let slot = (turn + seat) % N;
      while (board[slot] !== 0) slot = (slot + 1) % N;
      const out = place(room, seat, slot);
      const placed = msgs(out, "placed")[0];
      assert.deepEqual(placed, { t: "placed", turn, seat }); // 칸은 알려 주지 않는다
      if (seat < 7) {
        assert.equal(msgs(out, "reveal").length, 0);
        // 남의 보드에는 이번 턴 수가 안 보인다
        const st = stateFor(room, 7, now) as { seats: { board: number[] }[]; mySlot: number };
        assert.equal(st.seats[seat].board[slot], 0);
        assert.equal(st.mySlot, -1);
      } else {
        const rev = msgs(out, "reveal")[0] as { turn: number; card: number; seats: { seat: number; slot: number; auto: boolean; score: number }[] };
        assert.equal(rev.turn, turn);
        assert.equal(rev.card, DECK[turn]);
        assert.equal(rev.seats.length, 8);
        assert.ok(rev.seats.every((s) => !s.auto));
        finished = msgs(out, "finished")[0];
        if (turn < N - 1) assert.equal(msgs(out, "card")[0].card, DECK[turn + 1]);
      }
    }
  }
  assert.equal(room.phase, "finished");
  const res = finished as { seats: { seat: number; score: number; rank: number }[] };
  for (const r of res.seats) {
    const s = room.seats[r.seat];
    assert.equal(r.score, score(s.board));
    assert.equal(r.rank, 1 + res.seats.filter((x) => x.score > r.score).length);
    assert.deepEqual([...s.board].sort((a, b) => a - b), [...DECK].sort((a, b) => a - b));
  }
  assert.equal(room.moves.length, 8 * N);
  // 상태에는 덱이 없다
  assert.ok(!JSON.stringify(stateFor(room, 0, now)).includes('"deck"'));
  // 한 판 더: 방장이 다시 시작
  send(room, 0, { t: "start" });
  assert.equal(room.phase, "playing");
  assert.ok(room.seats.every((s) => s.board.every((v) => v === 0) && s.rank === 0));
}

// ── place 오류 · 재전송 ──
{
  const room = lobby(2);
  send(room, 0, { t: "start" });
  assert.equal(errCode(send(room, 0, { t: "place", turn: 1, slot: 0, thinkMs: 1 })), "wrong_turn");
  assert.equal(errCode(send(room, 0, { t: "place", turn: 0, slot: 20, thinkMs: 1 })), "invalid_slot");
  place(room, 0, 4);
  // 같은 칸으로 다시 보냄 → 나에게만 placed, 다른 칸 → already_placed
  assert.deepEqual(place(room, 0, 4), [{ to: 0, msg: { t: "placed", turn: 0, seat: 0 } }]);
  assert.equal(errCode(place(room, 0, 5)), "already_placed");
  place(room, 1, 4);
  assert.equal(room.turn, 1);
  assert.equal(errCode(place(room, 0, 4)), "invalid_slot"); // 이미 찬 칸
  assert.equal(stateFor(room, 0, now).mySlot, -1);
  place(room, 0, 9);
  assert.equal(stateFor(room, 0, now).mySlot, 9);
}

// ── 시간 초과 → 두 번 연속이면 AI 가 이어 둠 → 돌아오면 돌려받음 ──
{
  const room = lobby(2);
  send(room, 0, { t: "start" });
  place(room, 0, 10);
  assert.deepEqual(tick(room, deps()), []); // 아직 마감 전
  assert.equal(nextAlarm(room), now + TURN_MS);
  now += TURN_MS;
  let out = tick(room, deps());
  let rev = msgs(out, "reveal")[0] as { seats: { seat: number; slot: number; auto: boolean }[] };
  assert.deepEqual(rev.seats.map((s) => s.auto), [false, true]);
  assert.equal(rev.seats[1].slot, 0); // 입문 AI 대신 첫 빈칸
  assert.equal(room.seats[1].auto, false); // 한 번은 아직
  assert.equal(room.moves.find((m) => m.seat === 1)!.auto, true);
  // 두 번째 시간 초과
  place(room, 0, 11);
  now += TURN_MS;
  out = tick(room, deps());
  assert.equal(room.seats[1].auto, true);
  assert.equal(msgs(out, "state").length, 2); // 자리 상태가 바뀌어 모두에게
  // 이제 카드가 나오자마자 AI 가 둔다 → 0 만 두면 바로 공개
  assert.equal(room.seats[1].slot >= 0, true);
  out = place(room, 0, 12);
  assert.equal(msgs(out, "reveal").length, 1);
  // 돌아가기 → 다음 카드부터 직접
  send(room, 1, { t: "resume" });
  assert.equal(room.seats[1].auto, false);
  assert.equal(room.seats[1].slot >= 0, true); // 이번 카드는 이미 AI 가 둠
  place(room, 0, 13);
  assert.equal(room.seats[1].slot, -1); // 다음 카드는 직접
  // 직접 두면 연속 시간 초과가 다시 0부터
  place(room, 1, 13);
  assert.equal(room.seats[1].timeouts, 0);
}

// ── 판 도중 나가기 · 모두 나가면 AI 끼리 끝까지 ──
{
  const room = lobby(3);
  send(room, 0, { t: "start" });
  place(room, 0, 0);
  place(room, 1, 0);
  let out = send(room, 2, { t: "leave" });
  assert.deepEqual(out[0], { to: 2, close: 1000 });
  assert.equal(room.seats[2].auto, true);
  assert.equal(room.seats[2].online, false);
  assert.equal(msgs(out, "reveal").length, 1); // 나간 자리를 AI 가 바로 두어 공개
  // 끊긴 자리는 판 도중엔 비우지 않는다
  now += DROP_MS;
  tick(room, deps());
  assert.equal(room.seats.length, 3);
  // 돌아오면 돌려받음
  connect(room, 2, deps());
  assert.equal(room.seats[2].auto, false);
  for (const n of [0, 1, 2]) send(room, n, { t: "leave" });
  assert.equal(room.phase, "finished");
  assert.equal(room.moves.length, 3 * N);
  assert.ok(room.emptySince !== null);
}

// ── 대기실: 끊긴 자리 비우기, 방장 넘기기, 빈 방 지우기 ──
{
  const room = lobby(3);
  disconnect(room, 0, deps());
  assert.equal(nextAlarm(room), now + DROP_MS);
  now += DROP_MS - 1;
  assert.deepEqual(tick(room, deps()), []);
  now += 1;
  const out = tick(room, deps());
  assert.deepEqual(room.seats.map((s) => s.seat), [1, 2]);
  assert.equal(room.host, 1);
  assert.equal((msgs(out, "state")[0] as { host: number }).host, 1);
  // 남은 둘도 끊김 → 60초 뒤 자리 비움, 10분 뒤 방 지움
  disconnect(room, 1, deps());
  disconnect(room, 2, deps());
  const empty = now;
  assert.equal(expired(room, now + EMPTY_MS - 1), false);
  assert.equal(expired(room, now + EMPTY_MS), true);
  now += DROP_MS;
  tick(room, deps());
  assert.equal(room.seats.length, 0);
  assert.equal(nextAlarm(room), empty + EMPTY_MS);
}

// ── 방을 만들고 아무도 안 붙으면 10분 뒤 지움 ──
{
  const room = newRoom("ABCDEF", now);
  addSeat(room, "a", null, "t", now);
  assert.equal(nextAlarm(room), now + DROP_MS);
  assert.equal(expired(room, now + EMPTY_MS), true);
}

console.log("room ok");
