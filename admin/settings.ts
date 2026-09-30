// 관리자 설정 읽기·쓰기 (migration 0006 site_settings). 게임 서버는 worker/settings.ts 로 읽는다.
import type { SettingDef } from "./games/types.ts";

export async function readSettings(db: D1Database, game: string, defs: SettingDef[]) {
  const { results } = await db.prepare(`SELECT key, value, updated_at, updated_by FROM site_settings WHERE game = ?`).bind(game)
    .all<{ key: string; value: string; updated_at: string; updated_by: string | null }>();
  const saved = new Map(results.map((r) => [r.key, r]));
  return defs.map((d) => {
    const r = saved.get(d.key);
    return { key: d.key, value: r ? JSON.parse(r.value) : d.default, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
  });
}

/** 설정 정의에 맞는 값이면 정리해서 돌려주고, 아니면 null */
export function checkSetting(def: SettingDef, value: unknown): unknown {
  if (def.type === "toggle") return typeof value === "boolean" ? value : null;
  if (!Array.isArray(value)) return null;
  const ids = def.options.map((o) => o.id);
  if (!value.every((v) => typeof v === "string" && ids.includes(v))) return null;
  return ids.filter((id) => value.includes(id)); // 정의 순서로, 중복 없이
}

export async function writeSetting(db: D1Database, game: string, key: string, value: unknown, by: string) {
  await db.prepare(`INSERT INTO site_settings (game, key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (game, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(game, key, JSON.stringify(value), new Date().toISOString(), by).run();
}
