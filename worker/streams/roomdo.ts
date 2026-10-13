// STREAMS 멀티 방 Durable Object — 규칙은 room.ts, 여기는 저장 · 웹소켓 · 타이머만.
// 방 하나 = DO 하나 (idFromName(방 코드)). 계약은 docs/streams-api.md 의 "멀티 (방)" 절.
// 웹소켓은 하이버네이션 API: 연결마다 자리 번호를 attachment 에 두고, ping/pong 은 DO 를 깨우지 않는다.
// room.ts 함수는 await 없이 방을 고치고 메시지를 돌려준다 — 그 사이에 다른 메시지가 끼어들지 않는다. 저장은 그 뒤에.
// 판이 끝나면 D1(migration 0008)에 한 번에 쓰고 실시간 통계에 알린다 (관리자 설정 streams/collect 를 따른다).
import { DurableObject } from "cloudflare:workers";
import { hub, loadAI, type Env } from "./api.ts";
import { newDeck, score } from "./game.ts";
import { setting } from "../settings.ts";
import {
  addSeat, connect, disconnect, expired, handle, newRoom, nextAlarm, parseClient, seatByToken, tick,
  type Deps, type Out, type Room,
} from "./room.ts";

const EDITOR = "unity-editor/";

const HELLO_MS = 5000;   // 연결하고 hello 를 보내기까지
const MAX_MSG = 1024;    // 메시지 크기
const MAX_PER_SEC = 10;  // 연결당 초당 메시지

/** 연결마다 붙여 두는 값. seat -1 = 아직 hello 전 (또는 자리를 내준 옛 연결) */
type Attach = { seat: number; at: number };

/** 모델을 못 읽으면(로컬 개발 등) 무작위 빈칸 */
function randomEmpty(board: number[]): number {
  const empty = board.flatMap((v, i) => (v === 0 ? [i] : []));
  return empty[Math.floor(Math.random() * empty.length)];
}

export class StreamsRoom extends DurableObject<Env> {
  private room: Room | null | undefined; // undefined = 아직 storage 에서 안 읽음
  private rate = new Map<WebSocket, { sec: number; n: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ── Worker 가 부르는 것 (HTTP) ──

  /** 방 만들기. 이미 쓰는 코드면 null (Worker 가 다른 코드로 다시) */
  async create(code: string, name: string, playerId: string | null, client: string | null, token: string): Promise<number | null> {
    if (await this.load()) return null;
    const room = (this.room = newRoom(code, Date.now()));
    const seat = addSeat(room, name, playerId, client, token, Date.now());
    await this.save();
    return typeof seat === "object" ? seat.seat : null;
  }

  /** 들어가기. 자리 번호 또는 오류 ("room not found" · "room full" · "game in progress") */
  async join(name: string, playerId: string | null, client: string | null, token: string): Promise<number | string> {
    const room = await this.load();
    if (!room) return "room not found";
    const seat = addSeat(room, name, playerId, client, token, Date.now());
    if (typeof seat === "string") return seat;
    await this.save();
    return seat.seat;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const room = await this.load();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: -1, at: Date.now() } satisfies Attach);
    // 없는 방이면 hello 를 받을 때 4004 로 닫는다 (101 전에 닫으면 닫는 코드가 전달되지 않는다)
    if (room) await this.save(); // hello 마감 알람
    else await this.ctx.storage.setAlarm(Date.now() + HELLO_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── 웹소켓 ──

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > MAX_MSG || this.flood(ws)) return ws.close(1008, "policy");
    const room = await this.load();
    if (!room) return ws.close(4004, "room not found");
    const a = ws.deserializeAttachment() as Attach;
    const d = await this.deps();

    if (a.seat < 0) {
      const seat = seatByToken(room, helloToken(data));
      if (!seat) return ws.close(4001, "bad hello");
      // 같은 자리의 옛 연결(다른 탭)은 자리를 내주고 닫는다 — 닫힘 처리에서 disconnect 하지 않게 먼저 떼어 낸다
      for (const old of this.ctx.getWebSockets()) {
        if (old !== ws && (old.deserializeAttachment() as Attach | null)?.seat === seat.seat) {
          old.serializeAttachment({ seat: -1, at: 0 } satisfies Attach);
          try { old.close(4000, "replaced"); } catch { /* 이미 닫힘 */ }
        }
      }
      ws.serializeAttachment({ seat: seat.seat, at: a.at } satisfies Attach);
      this.send(connect(room, seat.seat, d));
    } else {
      if (!room.seats.some((s) => s.seat === a.seat)) return ws.close(4001, "seat gone");
      const m = parseClient(data);
      if (!m) ws.send(JSON.stringify({ t: "error", code: "bad_message", message: "bad_message" }));
      else this.send(handle(room, a.seat, m, d));
    }
    await this.save();
  }

  async webSocketClose(ws: WebSocket) {
    this.rate.delete(ws);
    const a = ws.deserializeAttachment() as Attach | null;
    if (!a || a.seat < 0) return;
    const room = await this.load();
    if (!room) return;
    this.send(disconnect(room, a.seat, await this.deps()));
    await this.save();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  // ── 타이머: 턴 마감 · 끊긴 자리 · hello 마감 · 빈 방 지우기 ──

  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attach | null;
      if (a && a.seat < 0 && a.at > 0 && now - a.at >= HELLO_MS) {
        try { ws.close(4001, "no hello"); } catch { /* 이미 닫힘 */ }
      }
    }
    const room = await this.load();
    if (!room) return;
    if (expired(room, now)) {
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close(4004, "room closed"); } catch { /* 이미 닫힘 */ }
      }
      this.room = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    this.send(tick(room, await this.deps()));
    await this.save();
  }

  // ── 안쪽 ──

  private async load(): Promise<Room | null> {
    if (this.room === undefined) this.room = (await this.ctx.storage.get<Room>("room")) ?? null;
    return this.room;
  }

  /** 방을 저장하고 다음 알람을 맞춘다 */
  private async save() {
    if (!this.room) return;
    await this.ctx.storage.put("room", this.room);
    const times: number[] = [];
    const next = nextAlarm(this.room);
    if (next !== null) times.push(next);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attach | null;
      if (a && a.seat < 0 && a.at > 0) times.push(a.at + HELLO_MS);
    }
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  /** 시간 초과 · 대신 두기는 입문 AI. AI 는 메시지를 처리하기 전에 미리 읽어 둔다 (처리 중 await 없게) */
  private async deps(): Promise<Deps> {
    let choose: Deps["choose"] = randomEmpty;
    try {
      const ai = await loadAI(this.env);
      choose = (board, card) => ai.choose(board, card, 1);
    } catch (e) {
      console.error("streams room: ai load failed, using random", e);
    }
    return { now: Date.now(), choose, newDeck };
  }

  private send(outs: Out[]) {
    if (this.room && outs.some((o) => o.msg?.t === "finished")) this.record(this.room);
    const conns = this.ctx.getWebSockets().map((ws) => ({ ws, seat: (ws.deserializeAttachment() as Attach | null)?.seat ?? -1 }));
    for (const o of outs) {
      for (const { ws, seat } of conns) {
        if (seat < 0 || (o.to !== "all" && o.to !== seat)) continue;
        try {
          if (o.msg) ws.send(JSON.stringify(o.msg));
          if (o.close) ws.close(o.close, "bye");
        } catch { /* 이미 닫힘 */ }
      }
    }
  }

  /** 끝난 판을 D1 에 남긴다. 값은 지금 바로 떠 두고(다음 판이 곧 시작될 수 있다) 쓰기는 뒤에서 */
  private record(room: Room) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    const now = new Date().toISOString();
    const db = this.env.DB;
    const writes = [db.prepare(`INSERT INTO streams_pvp_games (id, room, deck, seats, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, room.code, JSON.stringify(room.deck), room.seats.length, new Date(room.startedAt).toISOString(), now)];
    const autoTurns = (seat: number) => room.moves.filter((m) => m.seat === seat && m.auto).length;
    writes.push(db.prepare(`INSERT INTO streams_pvp_seats (game_id, seat, player_id, client, board, score, rank, auto_turns) VALUES `
      + room.seats.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", "))
      .bind(...room.seats.flatMap((s) => [id, s.seat, s.playerId, s.client, JSON.stringify(s.board), score(s.board), s.rank, autoTurns(s.seat)])));
    // 턴마다 한 문장 (자리 8개 × 7 = 56 칸 — D1 의 바인드 100개 한도 안)
    for (let turn = 0; turn < 20; turn++) {
      const moves = room.moves.filter((m) => m.turn === turn);
      if (moves.length === 0) continue;
      writes.push(db.prepare(`INSERT INTO streams_pvp_turns (game_id, turn, seat, card, slot, think_ms, auto) VALUES `
        + moves.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", "))
        .bind(...moves.flatMap((m) => [id, m.turn, m.seat, m.card, m.slot, m.thinkMs, m.auto ? 1 : 0])));
    }
    const counted = room.seats.some((s) => !(s.client ?? "").startsWith(EDITOR));
    this.ctx.waitUntil((async () => {
      if (!(await setting(db, "streams", "collect", true))) return;
      // 허브를 먼저: 허브가 처음 깨어나면 D1 에서 다시 세는데, 이 판을 쓴 뒤라면 두 번 센다
      if (counted) await hub(this.env).pvpFinished(id);
      await db.batch(writes);
    })().catch((e) => console.error("streams room: record failed", e)));
  }

  private flood(ws: WebSocket): boolean {
    const sec = Math.floor(Date.now() / 1000);
    const r = this.rate.get(ws);
    if (!r || r.sec !== sec) {
      this.rate.set(ws, { sec, n: 1 });
      return false;
    }
    return ++r.n > MAX_PER_SEC;
  }
}

function helloToken(data: string): string {
  try {
    const m = JSON.parse(data);
    return m?.t === "hello" && typeof m.seatToken === "string" ? m.seatToken : "";
  } catch {
    return "";
  }
}
