-- STREAMS 플레이 기록. 덱은 서버만 보유하고 카드는 한 장씩 공개한다.
CREATE TABLE streams_games (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL,              -- 이 게임의 수를 둘 수 있는 비밀값 (클라이언트만 앎)
  player_id    TEXT,                       -- 브라우저에 저장한 익명 id (재방문 분석용)
  level        INTEGER NOT NULL,           -- 1~5
  ai_model     TEXT NOT NULL,              -- 예: v17-pikl
  deck         TEXT NOT NULL,              -- JSON [20]
  player_board TEXT NOT NULL,              -- JSON [20], 0 = 빈칸
  ai_board     TEXT NOT NULL,
  turn         INTEGER NOT NULL DEFAULT 0, -- 놓은 카드 수
  player_score INTEGER,
  ai_score     INTEGER,
  status       TEXT NOT NULL DEFAULT 'playing',  -- playing | finished
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE TABLE streams_turns (
  game_id     TEXT NOT NULL,
  turn        INTEGER NOT NULL,            -- 0~19
  card        INTEGER NOT NULL,
  player_slot INTEGER NOT NULL,
  ai_slot     INTEGER NOT NULL,
  think_ms    INTEGER,                     -- 카드를 본 뒤 놓기까지 걸린 시간 (클라이언트 측정)
  created_at  TEXT NOT NULL,
  PRIMARY KEY (game_id, turn)
);

CREATE INDEX streams_games_created ON streams_games (created_at);
CREATE INDEX streams_games_player ON streams_games (player_id);
