// 관리자 설정 읽기 (migration 0006 site_settings). 관리자 페이지(admin/)에서 바꾼다.
// 요청마다 D1 을 치지 않도록 isolate 안에서 30초 들고 있는다 — 바꾼 설정은 최대 30초 뒤에 적용된다.
// 테이블이 없거나 읽지 못하면 기본값을 쓴다 (설정 때문에 게임이 멈추지 않게).

const TTL = 30_000;
const cache = new Map<string, { at: number; value: Record<string, unknown> }>();

async function load(db: D1Database, game: string): Promise<Record<string, unknown>> {
  const hit = cache.get(game);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value: Record<string, unknown> = {};
  try {
    const { results } = await db.prepare(`SELECT key, value FROM site_settings WHERE game = ?`).bind(game).all<{ key: string; value: string }>();
    for (const r of results) value[r.key] = JSON.parse(r.value);
  } catch (e) {
    console.error("settings read failed", e);
  }
  cache.set(game, { at: Date.now(), value });
  return value;
}

export async function setting<T>(db: D1Database, game: string, key: string, fallback: T): Promise<T> {
  const v = (await load(db, game))[key];
  return v === undefined ? fallback : (v as T);
}
