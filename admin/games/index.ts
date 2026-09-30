// 관리자 페이지가 다루는 게임들. 데이터를 모으는 게임이 생기면 모듈(types.ts 의 GameAdmin)을 만들어 여기 넣는다.
import { streams } from "./streams.ts";
import type { GameAdmin } from "./types.ts";

export const GAMES: GameAdmin[] = [streams];
export const gameById = (id: string) => GAMES.find((g) => g.id === id);
