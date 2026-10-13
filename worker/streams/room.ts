// STREAMS 멀티 방 규칙 — 계약은 docs/streams-api.md 의 "멀티 (방)" 절.
// 순수 함수만: 시각 · 덱 · AI 는 밖(DO)에서 넣어 준다 → node 로 테스트 (room.test.ts).
// 함수는 방(Room)을 직접 고치고, 보낼 메시지(Out[])를 돌려준다. 웹소켓 · 저장 · 타이머는 DO 가 맡는다.
// 덱은 방 밖으로 나가지 않는다: 메시지에는 이번 카드와 공개된 보드만 들어간다.

import { N, score } from "./game.ts";

export const MAX_SEATS = 8;
export const TURN_MS = 20_000;          // 카드마다 제한 시간
export const DROP_MS = 60_000;          // 대기실 · 판이 끝난 뒤 끊긴 자리를 비우기까지
export const EMPTY_MS = 10 * 60_000;    // 연결이 하나도 없으면 방을 지우기까지
export const AUTO_AFTER = 2;            // 연속 시간 초과 몇 번이면 AI 가 자리를 이어 두나
export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I·L 뺌
export const CODE_LEN = 6;

export type Phase = "lobby" | "playing" | "finished";

export interface Seat {
  seat: number;               // 0~7, 방 안에서 바뀌지 않는다
  name: string;
  playerId: string | null;    // 기록용. 메시지로 내보내지 않는다
  client: string | null;      // 들어올 때의 x-streams-client (기록 · 통계에서 에디터 판을 빼는 데)
  token: string;              // seatToken
  online: boolean;
  offlineSince: number | null;
  auto: boolean;              // AI 가 대신 두는 중
  timeouts: number;           // 연속 시간 초과
  board: number[];            // 공개된 카드만 (이번 턴 수는 reveal 때 들어간다)
  slot: number;               // 이번 카드를 놓은 칸, 아직이면 -1
  slotAuto: boolean;          // 이번 수를 AI 가 뒀다 (시간 초과 · 대신 두기)
  thinkMs: number | null;
  rank: number;               // finished 일 때 등수, 아니면 0
}

/** 판 기록 (D1 용). auto 수는 학습 데이터에서 뺀다 */
export interface Move { turn: number; card: number; seat: number; slot: number; thinkMs: number | null; auto: boolean }

export interface Room {
  code: string;
  phase: Phase;
  host: number;
  seats: Seat[];              // seat 번호 순
  deck: number[];
  turn: number;               // playing: 이번 카드 번호 0~19
  startedAt: number;          // 이번 판을 시작한 시각 (기록용)
  deadline: number;           // playing: 이번 카드 마감 시각
  emptySince: number | null;  // 연결된 자리가 하나도 없게 된 시각
  moves: Move[];              // 이번 판
}

/** DO 가 넣어 주는 것 */
export interface Deps {
  now: number;
  choose: (board: number[], card: number) => number; // 시간 초과 · 대신 두기 (입문 AI)
  newDeck: () => number[];
}

// ── 메시지 ──────────────────────────────────────────────────────────

export type ClientMsg =
  | { t: "start" }
  | { t: "place"; turn: number; slot: number; thinkMs: number | null }
  | { t: "resume" }
  | { t: "leave" };

export type ErrorCode = "bad_message" | "not_host" | "need_players" | "bad_phase" | "wrong_turn" | "already_placed" | "invalid_slot";

/** to: 자리 번호 또는 "all"(연결된 모두). close 가 있으면 DO 가 그 자리의 연결을 닫는다 */
export interface Out { to: number | "all"; msg?: Record<string, unknown>; close?: number }

/** hello 를 뺀 클라이언트 메시지. hello 는 DO 가 토큰으로 자리를 찾은 뒤 connect() */
export function parseClient(raw: string): ClientMsg | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  switch (m.t) {
    case "start": case "resume": case "leave":
      return { t: m.t };
    case "place": {
      if (!Number.isInteger(m.turn) || !Number.isInteger(m.slot)) return null;
      const thinkMs = typeof m.thinkMs === "number" && Number.isFinite(m.thinkMs) ? Math.max(0, Math.round(m.thinkMs)) : null;
      return { t: "place", turn: m.turn as number, slot: m.slot as number, thinkMs };
    }
    default:
      return null;
  }
}

// ── 방 · 자리 ───────────────────────────────────────────────────────

/** 닉네임: 제어 문자 · 앞뒤 공백을 지우고 1~12자. 틀리면 null */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\p{Cc}/gu, "").trim();
  const len = [...name].length;
  return len >= 1 && len <= 12 ? name : null;
}

/** 방 코드: 대소문자 구분 없이 받는다. 틀리면 null */
export function normCode(raw: string): string | null {
  const code = raw.toUpperCase();
  return code.length === CODE_LEN && [...code].every((c) => CODE_CHARS.includes(c)) ? code : null;
}

export function newRoom(code: string, now: number): Room {
  return { code, phase: "lobby", host: 0, seats: [], deck: [], turn: -1, startedAt: 0, deadline: 0, emptySince: now, moves: [] };
}

/** 방 만들기 · 들어가기 (HTTP). 웹소켓 hello 전이라 online 은 false */
export function addSeat(room: Room, name: string, playerId: string | null, client: string | null, token: string, now: number): Seat | "room full" | "game in progress" {
  if (room.phase === "playing") return "game in progress";
  if (room.seats.length >= MAX_SEATS) return "room full";
  let n = 0;
  while (room.seats.some((s) => s.seat === n)) n++;
  const seat: Seat = {
    seat: n, name, playerId, client, token, online: false, offlineSince: now, auto: false, timeouts: 0,
    board: Array(N).fill(0), slot: -1, slotAuto: false, thinkMs: null, rank: 0,
  };
  room.seats.push(seat);
  room.seats.sort((a, b) => a.seat - b.seat);
  if (room.seats.length === 1) room.host = n;
  return seat;
}

export const seatByToken = (room: Room, token: string) => room.seats.find((s) => s.token === token);
const seatOf = (room: Room, n: number) => room.seats.find((s) => s.seat === n)!;

/** hello: 연결됨. AI 가 대신 두던 자리면 돌려받는다 */
export function connect(room: Room, n: number, d: Deps): Out[] {
  const s = seatOf(room, n);
  s.online = true;
  s.offlineSince = null;
  s.auto = false;
  s.timeouts = 0;
  room.emptySince = null;
  return stateAll(room, d.now);
}

/** 연결이 끊김 (여러 번 불려도 된다) */
export function disconnect(room: Room, n: number, d: Deps): Out[] {
  const s = room.seats.find((x) => x.seat === n);
  if (!s || !s.online) return [];
  s.online = false;
  s.offlineSince = d.now;
  if (!room.seats.some((x) => x.online)) room.emptySince = d.now;
  return stateAll(room, d.now);
}

export function handle(room: Room, n: number, m: ClientMsg, d: Deps): Out[] {
  const s = seatOf(room, n);
  switch (m.t) {
    case "start": return start(room, s, d);
    case "place": return place(room, s, m, d);
    case "resume":
      if (!s.auto) return [];
      s.auto = false;
      s.timeouts = 0;
      return stateAll(room, d.now);
    case "leave": {
      const out: Out[] = [{ to: n, close: 1000 }];
      if (room.phase === "playing") {
        s.auto = true;
        out.push(...disconnect(room, n, d));
        // 이번 카드를 아직 안 놓았으면 AI 가 바로 둔다
        if (s.slot < 0) out.push(...autoPlace(room, s, d), ...advance(room, d));
        return out;
      }
      removeSeat(room, n, d.now);
      return [...out, ...stateAll(room, d.now)];
    }
  }
}

/** 타이머 (DO alarm): 턴 마감, 끊긴 자리 비우기. 방을 지울지는 expired() */
export function tick(room: Room, d: Deps): Out[] {
  const out: Out[] = [];
  if (room.phase === "playing") {
    if (d.now < room.deadline) return out;
    let changed = false;
    for (const s of room.seats) {
      if (s.slot >= 0) continue;
      s.timeouts++;
      if (s.timeouts >= AUTO_AFTER && !s.auto) {
        s.auto = true;
        changed = true;
      }
      out.push(...autoPlace(room, s, d));
    }
    if (changed) out.push(...stateAll(room, d.now));
    out.push(...advance(room, d));
    return out;
  }
  const gone = room.seats.filter((s) => !s.online && s.offlineSince !== null && d.now - s.offlineSince >= DROP_MS);
  for (const s of gone) removeSeat(room, s.seat, d.now);
  return gone.length ? stateAll(room, d.now) : out;
}

/** 다음에 tick 을 불러야 할 시각 (없으면 null) */
export function nextAlarm(room: Room): number | null {
  const times: number[] = [];
  if (room.phase === "playing") times.push(room.deadline);
  else for (const s of room.seats) if (!s.online && s.offlineSince !== null) times.push(s.offlineSince + DROP_MS);
  if (room.emptySince !== null) times.push(room.emptySince + EMPTY_MS);
  return times.length ? Math.min(...times) : null;
}

/** 연결이 하나도 없이 EMPTY_MS 가 지났다 → DO 가 방을 지운다 */
export const expired = (room: Room, now: number) => room.emptySince !== null && now - room.emptySince >= EMPTY_MS;

/** 자리 하나에 보낼 전체 상태 */
export function stateFor(room: Room, n: number, now: number): Record<string, unknown> {
  const playing = room.phase === "playing";
  return {
    t: "state", code: room.code, phase: room.phase, you: n, host: room.host,
    turn: playing ? room.turn : -1,
    card: playing ? room.deck[room.turn] : 0,
    timeLeftMs: playing ? Math.max(0, room.deadline - now) : 0,
    mySlot: playing ? seatOf(room, n).slot : -1,
    seats: room.seats.map((s) => ({
      seat: s.seat, name: s.name, online: s.online, auto: s.auto, placed: playing && s.slot >= 0,
      score: score(s.board), rank: s.rank, board: s.board,
    })),
  };
}

// ── 안쪽 ────────────────────────────────────────────────────────────

const stateAll = (room: Room, now: number): Out[] => room.seats.map((s) => ({ to: s.seat, msg: stateFor(room, s.seat, now) }));

function removeSeat(room: Room, n: number, now: number) {
  room.seats = room.seats.filter((s) => s.seat !== n);
  if (room.host === n && room.seats.length) room.host = room.seats[0].seat;
  if (!room.seats.some((s) => s.online) && room.emptySince === null) room.emptySince = now;
}

function start(room: Room, s: Seat, d: Deps): Out[] {
  if (room.phase === "playing") return err(s, "bad_phase");
  if (s.seat !== room.host) return err(s, "not_host");
  if (room.seats.filter((x) => x.online).length < 2) return err(s, "need_players");
  // 시작할 때 연결돼 있는 자리만 참가한다
  for (const x of room.seats.filter((x) => !x.online)) removeSeat(room, x.seat, d.now);
  for (const x of room.seats) {
    x.board = Array(N).fill(0);
    x.auto = false;
    x.timeouts = 0;
    x.rank = 0;
  }
  room.phase = "playing";
  room.deck = d.newDeck();
  room.moves = [];
  room.turn = 0;
  room.startedAt = d.now;
  return [...stateAll(room, d.now), ...deal(room, d)];
}

function place(room: Room, s: Seat, m: Extract<ClientMsg, { t: "place" }>, d: Deps): Out[] {
  if (room.phase !== "playing") return err(s, "bad_phase");
  if (m.turn !== room.turn) return err(s, "wrong_turn");
  if (s.slot >= 0) return s.slot === m.slot ? [{ to: s.seat, msg: placedMsg(room, s) }] : err(s, "already_placed");
  if (m.slot < 0 || m.slot >= N || s.board[m.slot] !== 0) return err(s, "invalid_slot");
  s.slot = m.slot;
  s.slotAuto = false;
  s.thinkMs = m.thinkMs;
  s.timeouts = 0;
  return [{ to: "all", msg: placedMsg(room, s) }, ...advance(room, d)];
}

/** 이번 카드를 내고, AI 가 대신 두는 자리는 바로 둔다 */
function deal(room: Room, d: Deps): Out[] {
  room.deadline = d.now + TURN_MS;
  for (const s of room.seats) {
    s.slot = -1;
    s.thinkMs = null;
  }
  const out: Out[] = [{ to: "all", msg: { t: "card", turn: room.turn, card: room.deck[room.turn], timeLeftMs: TURN_MS } }];
  for (const s of room.seats) if (s.auto) out.push(...autoPlace(room, s, d));
  return out;
}

function autoPlace(room: Room, s: Seat, d: Deps): Out[] {
  s.slot = d.choose(s.board, room.deck[room.turn]);
  s.slotAuto = true;
  s.thinkMs = null;
  return [{ to: "all", msg: placedMsg(room, s) }];
}

/** 모두 놓았으면 공개하고 다음 카드로 (모두 AI 면 끝까지 한 번에) */
function advance(room: Room, d: Deps): Out[] {
  const out: Out[] = [];
  while (room.phase === "playing" && room.seats.every((s) => s.slot >= 0)) {
    out.push(reveal(room, d));
    if (room.turn === N - 1) {
      out.push(finish(room));
    } else {
      room.turn++;
      out.push(...deal(room, d));
    }
  }
  return out;
}

function reveal(room: Room, d: Deps): Out {
  const card = room.deck[room.turn];
  const seats = room.seats.map((s) => {
    const auto = s.slotAuto;
    s.board[s.slot] = card;
    room.moves.push({ turn: room.turn, card, seat: s.seat, slot: s.slot, thinkMs: s.thinkMs, auto });
    return { seat: s.seat, slot: s.slot, auto, score: score(s.board) };
  });
  return { to: "all", msg: { t: "reveal", turn: room.turn, card, seats } };
}

function finish(room: Room): Out {
  room.phase = "finished";
  room.turn = -1;
  const scores = room.seats.map((s) => score(s.board));
  for (const [i, s] of room.seats.entries()) s.rank = 1 + scores.filter((v) => v > scores[i]).length;
  for (const s of room.seats) s.slot = -1;
  return { to: "all", msg: { t: "finished", seats: room.seats.map((s, i) => ({ seat: s.seat, score: scores[i], rank: s.rank })) } };
}

const placedMsg = (room: Room, s: Seat) => ({ t: "placed", turn: room.turn, seat: s.seat });
const err = (s: Seat, code: ErrorCode): Out[] => [{ to: s.seat, msg: { t: "error", code, message: code } }];
