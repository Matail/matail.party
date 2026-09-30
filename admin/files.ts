// 내보내기 파일 만들기 (CSV · JSON) 와 조회 조건 읽기. 화면이 아닌 순수 함수라 node 로 바로 확인한다 (files.test.ts).
import type { Filter } from "./games/types.ts";

type Row = Record<string, unknown>;

/** 엑셀에서 한글이 깨지지 않게 BOM 을 붙인 CSV. 수식으로 읽힐 수 있는 문자열(=,+,-,@ 로 시작)은 앞에 ' 를 붙인다 */
export function toCsv(rows: Row[], columns = rows.length ? Object.keys(rows[0]) : []): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "string" ? v : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** JSON 내보내기: 문자열로 저장된 배열·객체 열을 풀어 넣는다 (못 풀면 그대로) */
export function toJsonRows(rows: Row[], jsonColumns: string[] = []): Row[] {
  if (!jsonColumns.length) return rows;
  return rows.map((r) => {
    const out = { ...r };
    for (const c of jsonColumns) {
      if (typeof out[c] !== "string" || out[c] === "") continue;
      try { out[c] = JSON.parse(out[c] as string); } catch { /* 그대로 */ }
    }
    return out;
  });
}

const KST = 9 * 3600e3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT = /^[a-z0-9-]{1,32}$/;

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (한국 날짜, 끝 날짜 포함) &level=1~5 &client=web → Filter. 틀린 값은 버린다 */
export function parseFilter(q: URLSearchParams, levels: number): Filter {
  const f: Filter = {};
  const from = q.get("from"), to = q.get("to"), level = Number(q.get("level")), client = q.get("client");
  if (from && DATE.test(from)) f.from = new Date(Date.parse(`${from}T00:00:00Z`) - KST).toISOString();
  if (to && DATE.test(to)) f.to = new Date(Date.parse(`${to}T00:00:00Z`) - KST + 86400e3).toISOString();
  if (Number.isInteger(level) && level >= 1 && level <= levels) f.level = level;
  if (client && CLIENT.test(client)) f.client = client;
  return f;
}

/** 파일 이름에 넣을 조건 요약: streams-games-2026-09-01_2026-09-30-lv3-web */
export function fileName(game: string, dataset: string, q: URLSearchParams, ext: string): string {
  const parts = [game, dataset];
  const from = q.get("from"), to = q.get("to");
  if ((from && DATE.test(from)) || (to && DATE.test(to))) parts.push(`${from && DATE.test(from) ? from : "처음"}_${to && DATE.test(to) ? to : "지금"}`);
  if (q.get("level")) parts.push(`lv${Number(q.get("level"))}`);
  if (q.get("client") && CLIENT.test(q.get("client")!)) parts.push(q.get("client")!);
  return `${parts.join("-")}.${ext}`;
}
