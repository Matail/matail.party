// TS 포팅 검증: streams-v17 의 runtime/ts/ 산출물(가중치·testvec)과 비교.
//   node worker/streams/ai.test.ts <streams-v17/runtime/ts 경로>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PolicyNet, StreamsAI, type Level } from "./ai.ts";

const dir = process.argv[2];
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const load = (n: string) => {
  const b = readFileSync(join(dir, `${n}.bin`));
  return new PolicyNet(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), manifest[n]);
};
const human = load("human_bc");
const ai = new StreamsAI(human, load("sgaz_d"));
const tests = JSON.parse(readFileSync(join(dir, "testvec.json"), "utf8"));

let maxErr = 0, match = 0, total = 0;
for (const t of tests) {
  const l = human.logits(t.board, t.card);
  t.human_logits.forEach((v: number, i: number) => (maxErr = Math.max(maxErr, Math.abs(v - l[i]))));
  for (const lv of [2, 3, 4, 5] as Level[]) {
    total++;
    if (ai.choose(t.board, t.card, lv) === t.choice[lv]) match++;
  }
}
const t0 = performance.now();
for (let i = 0; i < 200; i++) ai.choose(tests[i].board, tests[i].card, 5);
console.log(`logits 최대 오차 ${maxErr.toExponential(2)} | 선택 일치 ${match}/${total} | 레벨5 한 수 ${((performance.now() - t0) / 200).toFixed(2)}ms`);
