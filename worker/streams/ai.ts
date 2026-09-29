// STREAMS v17 AI — Worker용 추론 (streams-v17 리포 runtime/streams_ai.py 를 옮긴 것).
// 공정 정보: 보드(20칸, 0=빈칸)와 현재 카드만 본다. 덱 구성·순서는 쓰지 않는다.
// 난이도: π_β(a) ∝ exp( log π_h(a) + β · log π_SGAZ(a) )

import { N, POOL_CNT, SCORE_TABLE, runLengths } from "./game.ts";

export type Level = 1 | 2 | 3 | 4 | 5;

// 평가 2000판 평균: 22.3 / 32.6 / 39.2 / 46.7 / 49.0 (사람 평균 31.3)
export const LEVELS: Record<Level, { name: string; beta: number; how: "sample" | "argmax" }> = {
  1: { name: "입문", beta: 0, how: "sample" },
  2: { name: "보통", beta: 0, how: "argmax" },
  3: { name: "숙련", beta: 0.25, how: "argmax" },
  4: { name: "고수", beta: 0.5, how: "argmax" },
  5: { name: "마스터", beta: 2, how: "argmax" },
};

export type ManifestEntry = { name: string; shape: number[]; offset: number };

export class PolicyNet {
  private w: Record<string, Float32Array> = {};

  constructor(buf: ArrayBuffer, entries: ManifestEntry[]) {
    const all = new Float32Array(buf);
    for (const e of entries) {
      const size = e.shape.reduce((a, b) => a * b, 1);
      this.w[e.name] = all.subarray(e.offset, e.offset + size);
    }
  }

  // x: (cin,20) → (cout,20), kernel 3, padding 1, ReLU
  private conv(x: Float32Array, cin: number, name: string): Float32Array {
    const w = this.w[`${name}.weight`], b = this.w[`${name}.bias`];
    const cout = b.length;
    const y = new Float32Array(cout * N);
    for (let o = 0; o < cout; o++) {
      for (let t = 0; t < N; t++) {
        let s = b[o];
        for (let i = 0; i < cin; i++) {
          const wo = (o * cin + i) * 3, xi = i * N + t;
          if (t > 0) s += w[wo] * x[xi - 1];
          s += w[wo + 1] * x[xi];
          if (t < N - 1) s += w[wo + 2] * x[xi + 1];
        }
        y[o * N + t] = s > 0 ? s : 0;
      }
    }
    return y;
  }

  private linear(x: Float32Array, name: string, relu: boolean): Float32Array {
    const w = this.w[`${name}.weight`], b = this.w[`${name}.bias`];
    const n = x.length, y = new Float32Array(b.length);
    for (let o = 0; o < b.length; o++) {
      let s = b[o];
      const row = o * n;
      for (let i = 0; i < n; i++) s += w[row + i] * x[i];
      y[o] = relu && s < 0 ? 0 : s;
    }
    return y;
  }

  logits(board: number[], card: number): Float32Array {
    const [slots, glob] = encode(board, card);
    let x = this.conv(slots, 3, "conv.0");
    x = this.conv(x, 64, "conv.2");
    x = this.conv(x, 64, "conv.4");
    const h0 = new Float32Array(x.length + glob.length);
    h0.set(x);
    h0.set(glob, x.length);
    const h = this.linear(this.linear(h0, "body.0", true), "body.2", true);
    return this.linear(h, "policy", false);
  }
}

function encode(board: number[], card: number): [Float32Array, Float32Array] {
  const slots = new Float32Array(3 * N);
  let filled = 0;
  for (let i = 0; i < N; i++) {
    const occ = board[i] > 0 ? 1 : 0;
    filled += occ;
    slots[i] = board[i] / 30;
    slots[N + i] = occ;
    slots[2 * N + i] = (1 - occ) * card / 30;
  }
  const glob = new Float32Array(64);
  glob[card - 1] = 1;
  const counts = new Array(31).fill(0);
  for (const v of board) counts[v]++;
  for (let v = 1; v <= 30; v++) glob[30 + v - 1] = (POOL_CNT[v - 1] - counts[v] - (v === card ? 1 : 0)) / 2;
  const runs = runLengths(board);
  glob[60] = filled / N;
  glob[61] = (runs.length ? Math.max(...runs) : 0) / 20;
  glob[62] = Math.max(runs.length - 1, 0) / 20;
  glob[63] = runs.reduce((s, r) => s + SCORE_TABLE[r], 0) / 100;
  return [slots, glob];
}

function logSoftmaxLegal(z: Float32Array, legal: boolean[]): number[] {
  let m = -Infinity;
  for (let i = 0; i < N; i++) if (legal[i] && z[i] > m) m = z[i];
  let s = 0;
  for (let i = 0; i < N; i++) if (legal[i]) s += Math.exp(z[i] - m);
  const lse = m + Math.log(s);
  return Array.from(z, (v, i) => (legal[i] ? v - lse : -Infinity));
}

export class StreamsAI {
  private human: PolicyNet;
  private sgaz: PolicyNet;

  constructor(human: PolicyNet, sgaz: PolicyNet) {
    this.human = human;
    this.sgaz = sgaz;
  }

  choose(board: number[], card: number, level: Level, rand: () => number = Math.random): number {
    const { beta, how } = LEVELS[level];
    const legal = board.map((v) => v === 0);
    let z = logSoftmaxLegal(this.human.logits(board, card), legal);
    if (beta) {
      const s = logSoftmaxLegal(this.sgaz.logits(board, card), legal);
      z = z.map((v, i) => v + beta * s[i]);
    }
    if (how === "argmax") {
      let best = -1;
      for (let i = 0; i < N; i++) if (legal[i] && (best < 0 || z[i] > z[best])) best = i;
      return best;
    }
    const m = Math.max(...z.filter((_, i) => legal[i]));
    const p = z.map((v, i) => (legal[i] ? Math.exp(v - m) : 0));
    let r = rand() * p.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N; i++) if (legal[i] && (r -= p[i]) <= 0) return i;
    return legal.lastIndexOf(true);
  }
}
