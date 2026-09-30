// files.ts · settings.ts 의 순수 함수 확인.
//   node admin/files.test.ts
import assert from "node:assert/strict";
import { fileName, parseFilter, toCsv, toJsonRows } from "./files.ts";
import { checkSetting } from "./settings.ts";

// CSV: BOM, 머리줄, 따옴표·쉼표·줄바꿈, 빈 값, 수식 막기
const csv = toCsv([
  { id: "a", n: 3, note: 'he said "hi", ok', deck: "[1,2]", empty: null },
  { id: "b", n: -1, note: "=HYPERLINK(1)", deck: "line\nbreak", empty: undefined },
]);
assert.ok(csv.startsWith("﻿id,n,note,deck,empty\r\n"));
assert.equal(csv.split("\r\n")[1], 'a,3,"he said ""hi"", ok","[1,2]",');
assert.equal(csv.split("\r\n")[2], `b,-1,'=HYPERLINK(1),"line\nbreak",`);
assert.equal(toCsv([]), "﻿\r\n");

// JSON: 지정한 열만 풀고, 못 푸는 값은 그대로
assert.deepEqual(toJsonRows([{ deck: "[1,2]", data: "{bad", x: "[3]" }], ["deck", "data"]), [{ deck: [1, 2], data: "{bad", x: "[3]" }]);

// 조건: 한국 날짜 → UTC, 끝 날짜 포함 (다음날 0시 전까지)
const f = parseFilter(new URLSearchParams("from=2026-09-01&to=2026-09-30&level=3&client=unity-webgl"), 5);
assert.deepEqual(f, { from: "2026-08-31T15:00:00.000Z", to: "2026-09-30T15:00:00.000Z", level: 3, client: "unity-webgl" });
assert.deepEqual(parseFilter(new URLSearchParams("from=9/1&level=9&client=x' OR 1=1"), 5), {});
assert.deepEqual(parseFilter(new URLSearchParams("level=2"), 0), {});
assert.equal(fileName("streams", "games", new URLSearchParams("from=2026-09-01&level=3&client=web"), "csv"), "streams-games-2026-09-01_지금-lv3-web.csv");
assert.equal(fileName("streams", "turns", new URLSearchParams(""), "json"), "streams-turns.json");

// 설정 값 확인
const toggle = { key: "collect", label: "", note: "", type: "toggle", default: true } as const;
const multi = { key: "c", label: "", note: "", type: "multi", default: [], options: [{ id: "a", label: "" }, { id: "b", label: "" }] } as const;
assert.equal(checkSetting(toggle, false), false);
assert.equal(checkSetting(toggle, "false"), null);
assert.deepEqual(checkSetting(multi, ["b", "a", "b"]), ["a", "b"]);
assert.deepEqual(checkSetting(multi, []), []);
assert.equal(checkSetting(multi, ["z"]), null);
assert.equal(checkSetting(multi, "a"), null);

console.log("files.test: ok");
