// 규칙 테스트 벡터: game.ts 의 점수 계산을 다른 언어(Unity C#)로 옮길 때 맞춰 볼 정답지.
//   node worker/streams/vectors.ts           → worker/streams/testdata/rules.json 을 새로 쓴다
//   node worker/streams/vectors.ts --check   → 파일이 지금 game.ts 와 맞는지만 확인 (틀리면 exit 1)
// 시드가 고정이라 game.ts 가 바뀌지 않으면 파일도 바뀌지 않는다. 규칙을 고치면 다시 뽑고 Unity 쪽에도 복사한다.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { N, POOL, SCORE_TABLE, runLengths, score } from "./game.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "testdata", "rules.json");

// mulberry32 — 작고 결정적인 난수
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function deal(r: () => number): number[] {
  const p = [...POOL];
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.slice(0, N);
}

const board = (vals: [number, number][]) => {
  const b = Array(N).fill(0);
  for (const [i, v] of vals) b[i] = v;
  return b;
};

// 손으로 고른 경계 사례 — 빈칸은 구간을 끊지 않는다(건너뛴다), 같은 숫자는 이어진다
const edge: { note: string; board: number[] }[] = [
  { note: "빈 보드", board: Array(N).fill(0) },
  { note: "한 장", board: board([[7, 15]]) },
  { note: "1~20 오름차순 꽉 참 → 300", board: Array.from({ length: N }, (_, i) => i + 1) },
  { note: "20~1 내림차순 꽉 참 → 구간 20개 모두 1", board: Array.from({ length: N }, (_, i) => N - i) },
  { note: "같은 숫자 두 장은 이어짐", board: board([[0, 12], [1, 12]]) },
  { note: "빈칸 사이를 건너 이어짐", board: board([[0, 3], [10, 5], [19, 9]]) },
  { note: "빈칸을 건너도 내려가면 끊김", board: board([[0, 9], [10, 5], [19, 30]]) },
  { note: "마지막 칸만 참", board: board([[19, 30]]) },
  { note: "구간 둘: 길이 3 + 길이 2", board: board([[0, 1], [1, 2], [2, 3], [3, 1], [4, 2]]) },
];

function cases() {
  const r = rng(20260929);
  const out: { note?: string; board: number[] }[] = [...edge];
  // 무작위 보드: 앞에서부터 k 장을 무작위 빈칸에
  for (let n = 0; n < 400; n++) {
    const deck = deal(r), k = Math.floor(r() * (N + 1)), b = Array(N).fill(0);
    for (let t = 0; t < k; t++) {
      const empty = b.flatMap((v, i) => (v ? [] : [i]));
      b[empty[Math.floor(r() * empty.length)]] = deck[t];
    }
    out.push({ board: b });
  }
  // 긴 구간이 나오는 보드: 정렬해 놓고 몇 칸만 흔든다 (무작위만으로는 긴 구간이 거의 안 나옴)
  for (let n = 0; n < 200; n++) {
    const b = deal(r).sort((a, b) => a - b);
    for (let s = Math.floor(r() * 4); s > 0; s--) {
      const i = Math.floor(r() * N), j = Math.floor(r() * N);
      [b[i], b[j]] = [b[j], b[i]];
    }
    for (let z = Math.floor(r() * 6); z > 0; z--) b[Math.floor(r() * N)] = 0;
    out.push({ board: b });
  }
  return out.map((c) => ({ ...c, runs: runLengths(c.board), score: score(c.board) }));
}

const doc = {
  about: "STREAMS 규칙 정답지. worker/streams/vectors.ts 가 game.ts 로 만든다. 손으로 고치지 말 것.",
  version: 1,
  rules: { slots: N, pool: POOL, scoreTable: SCORE_TABLE },
  cases: cases(),
};
const text = JSON.stringify(doc, null, 1).replace(/\[\s+([\d,\s]+?)\s+\]/g, (_, xs) => `[${xs.replace(/\s+/g, "")}]`) + "\n";

if (process.argv.includes("--check")) {
  let old = "";
  try {
    old = readFileSync(OUT, "utf8");
  } catch {}
  if (old !== text) {
    console.error(`${OUT} 가 game.ts 와 다릅니다. node worker/streams/vectors.ts 로 다시 뽑으세요.`);
    process.exit(1);
  }
  console.log(`규칙 벡터 일치 (${doc.cases.length}개)`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`${OUT} — ${doc.cases.length}개`);
}
