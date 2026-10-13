-- STREAMS 멀티 방 판 기록 (docs/streams-unity-plan.md 5단계, docs/streams-api.md "멀티 (방)").
-- 방(Room DO)에서 판이 끝날 때 한 번에 쓴다. AI 대전(streams_games · streams_turns)과 모양이 달라 따로 둔다.
-- 사람끼리 같은 카드 순서를 받은 기록이라 학습에 좋은 비교 데이터가 된다 — 단 auto 수(시간 초과 · 나가서 AI 가 둔 수)는 뺀다.
-- 닉네임은 남기지 않는다. 사람은 AI 대전처럼 익명 player_id 로만.
CREATE TABLE streams_pvp_games (
  id          TEXT PRIMARY KEY,     -- 판 id (24자 hex). 방 하나에서 여러 판을 둘 수 있다
  room        TEXT NOT NULL,        -- 방 코드
  deck        TEXT NOT NULL,        -- JSON [20]
  seats       INTEGER NOT NULL,     -- 참가 자리 수 (2~8)
  created_at  TEXT NOT NULL,        -- 시작
  finished_at TEXT NOT NULL
);

CREATE TABLE streams_pvp_seats (
  game_id    TEXT NOT NULL,
  seat       INTEGER NOT NULL,      -- 방 안 자리 번호 0~7
  player_id  TEXT,                  -- 익명 id
  client     TEXT,                  -- 방에 들어올 때의 x-streams-client (unity-webgl/… · unity-editor/…)
  board      TEXT NOT NULL,         -- JSON [20]
  score      INTEGER NOT NULL,
  rank       INTEGER NOT NULL,      -- 1부터, 같은 점수는 같은 등수
  auto_turns INTEGER NOT NULL,      -- AI 가 대신 둔 수의 개수
  PRIMARY KEY (game_id, seat)
);

CREATE TABLE streams_pvp_turns (
  game_id  TEXT NOT NULL,
  turn     INTEGER NOT NULL,        -- 0~19
  seat     INTEGER NOT NULL,
  card     INTEGER NOT NULL,
  slot     INTEGER NOT NULL,
  think_ms INTEGER,                 -- 카드를 본 뒤 놓기까지 (클라이언트 측정). auto 수는 NULL
  auto     INTEGER NOT NULL,        -- 1 = 시간 초과 · 대신 두기로 AI 가 둔 수 (학습에서 뺀다)
  PRIMARY KEY (game_id, turn, seat)
);

CREATE INDEX streams_pvp_games_finished ON streams_pvp_games (finished_at);
