// POST /api/streams/events — 행동 기록 묶음 (2단계 데이터 수집, docs/streams-api.md).
// 분석용이라 잃어도 되는 기록이다: 응답을 먼저 보내고 D1 에는 뒤에서 쓴다. 학습용 streams_turns 와 섞지 않는다.

export const MAX_EVENTS = 50;   // 한 번에 받는 이벤트 수
export const MAX_DATA = 1024;   // 이벤트 하나의 data (JSON 문자열) 길이

const TYPE_RE = /^[a-z][a-z_]{0,31}$/;
const ID_RE = /^[0-9A-Za-z-]{1,64}$/;

export interface EventRow {
  gameId: string | null;
  seq: number;
  type: string;
  data: string | null;
  clientTs: number | null;
}

export interface EventBatch {
  sessionId: string | null;
  playerId: string | null;
  rows: EventRow[];
}

const id = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : null);

/** 요청 본문을 검사해 저장할 행으로 바꾼다. 형식이 틀린 이벤트는 버리고, 묶음 자체가 틀리면 오류 문자열. */
export function parseEvents(body: unknown): EventBatch | string {
  if (typeof body !== "object" || body === null) return "invalid body";
  const b = body as { sessionId?: unknown; playerId?: unknown; events?: unknown };
  if (!Array.isArray(b.events)) return "events must be an array";
  if (b.events.length > MAX_EVENTS) return `at most ${MAX_EVENTS} events`;

  const rows: EventRow[] = [];
  for (const e of b.events as unknown[]) {
    if (typeof e !== "object" || e === null) continue;
    const { gameId, seq, type, data, ts } = e as Record<string, unknown>;
    if (typeof type !== "string" || !TYPE_RE.test(type)) continue;
    if (!Number.isInteger(seq) || (seq as number) < 0) continue;
    // Unity(JsonUtility)는 data 를 JSON 문자열로, 웹은 객체로 보낼 수 있다 — 둘 다 문자열로 저장
    let json: string | null = null;
    if (typeof data === "string" && data !== "") {
      try { JSON.parse(data); json = data; } catch { continue; }
    } else if (typeof data === "object" && data !== null) {
      json = JSON.stringify(data);
    }
    if (json !== null && json.length > MAX_DATA) continue;
    rows.push({
      gameId: id(gameId),
      seq: seq as number,
      type,
      data: json,
      clientTs: Number.isFinite(ts) ? Math.round(ts as number) : null,
    });
  }
  return { sessionId: id(b.sessionId), playerId: id(b.playerId), rows };
}

/** 저장 쿼리들. 한 번의 batch 로 쓴다. */
export function insertEvents(db: D1Database, batch: EventBatch, client: string | null, now: string): D1PreparedStatement[] {
  const stmt = db.prepare(
    `INSERT INTO streams_events (session_id, player_id, game_id, seq, type, data, client, client_ts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return batch.rows.map((r) => stmt.bind(batch.sessionId, batch.playerId, r.gameId, r.seq, r.type, r.data, client, r.clientTs, now));
}
