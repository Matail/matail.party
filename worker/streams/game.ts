// STREAMS 규칙: 20칸에 카드를 한 장씩 놓고, 왼쪽부터 비내림차순(같은 숫자 허용) 구간 길이로 점수.
// 덱: 40장 풀(1~10, 11~20 두 장씩, 21~30)에서 무작위 20장.

export const N = 20;
export const POOL: number[] = [];
for (let v = 1; v <= 30; v++) POOL.push(...(v >= 11 && v <= 20 ? [v, v] : [v]));
export const POOL_CNT = Array.from({ length: 30 }, (_, i) => POOL.filter((v) => v === i + 1).length);
export const SCORE_TABLE = [0, 0, 1, 3, 5, 7, 9, 11, 15, 20, 25, 30, 35, 40, 50, 60, 70, 85, 100, 150, 300];

export function runLengths(board: number[]): number[] {
  const v = board.filter((x) => x);
  const runs: number[] = [];
  let i = 0;
  while (i < v.length) {
    let j = i;
    while (j + 1 < v.length && v[j] <= v[j + 1]) j++;
    runs.push(j - i + 1);
    i = j + 1;
  }
  return runs;
}

export function score(board: number[]): number {
  return runLengths(board).reduce((s, r) => s + SCORE_TABLE[r], 0);
}

export function newDeck(): number[] {
  const p = [...POOL];
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.slice(0, N);
}
