// 관리자 페이지가 게임마다 알아야 하는 것. 게임을 하나 추가하려면 이 모양의 모듈을 만들어 games/index.ts 에 넣는다.
// 화면은 게임을 모른다 — 게임 모듈이 돌려주는 블록(타일·막대·표)을 그대로 그리고, PDF 도 같은 블록으로 만든다.

export interface AdminEnv {
  DB: D1Database;
  /** my-site Worker 의 실시간 통계 DO (script_name 바인딩). 로컬에서는 없을 수 있다 */
  STATS?: DurableObjectNamespace;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

/** 조회 조건. 날짜는 UTC ISO (끝은 포함하지 않음) */
export interface Filter {
  from?: string;
  to?: string;
  level?: number;
  client?: string; // 클라이언트 종류 (web · unity-webgl · unity-editor · unknown)
}

export type Block =
  | { kind: "tiles"; items: { label: string; value: string; sub?: string }[] }
  | { kind: "bars"; title: string; note?: string; wide?: boolean; max?: number /* 막대 100% 기준 (없으면 가장 큰 값) */; rows: { label: string; value: number; text: string; warn?: boolean }[] }
  | { kind: "table"; title: string; note?: string; wide?: boolean; columns: { label: string; num?: boolean }[]; rows: (string | number | null)[][] };

export type SettingDef =
  | { key: string; label: string; note: string; type: "toggle"; default: boolean }
  | { key: string; label: string; note: string; type: "multi"; options: { id: string; label: string }[]; default: string[] };

export interface Dataset {
  id: string;
  label: string;
  note: string;
  /** JSON 으로 받을 때 문자열을 풀어 배열·객체로 넣을 열 */
  jsonColumns?: string[];
  query(db: D1Database, f: Filter, limit: number): D1PreparedStatement;
}

export interface GameAdmin {
  id: string;
  title: string;
  /** 난이도 이름 (1부터). 난이도가 없는 게임은 비운다 */
  levels: string[];
  /** 필터에 띄울 클라이언트 종류 (지금까지 들어온 것) */
  clients(db: D1Database): Promise<string[]>;
  overview(db: D1Database, f: Filter, now: number): Promise<Block[]>;
  datasets: Dataset[];
  settings: SettingDef[];
  /** 설정을 저장한 뒤 (예: 실시간 통계에 다시 읽으라고 알림). 실패하면 경고 문구 */
  onSaved?(env: AdminEnv, key: string): Promise<string | void>;
  cleanup: {
    label: string;
    note: string;
    /** 지울 기록을 미리 받는 내보내기 (datasets 의 id 와 필터) */
    backup: { dataset: string; filter: Filter };
    preview(db: D1Database): Promise<{ label: string; count: number }[]>;
    run(db: D1Database): Promise<{ label: string; count: number }[]>;
  };
}
