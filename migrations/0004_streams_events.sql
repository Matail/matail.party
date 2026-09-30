-- 2단계 데이터 수집 (docs/streams-unity-plan.md).
-- 판 종류: ai (AI 대전) | pvp (5단계 멀티). 지금까지의 판은 모두 ai.
ALTER TABLE streams_games ADD COLUMN mode TEXT NOT NULL DEFAULT 'ai';

-- 턴 기록으로 못 담는 행동 (칸 위에서 망설임, 판 포기, 재대전, 세션).
-- 분석용이라 잃어도 되는 기록이다 — 학습용 원본(streams_turns)과 섞지 않는다.
CREATE TABLE streams_events (
  session_id TEXT,              -- 앱을 한 번 켤 때마다 새 id (세션 길이·흐름 분석)
  player_id  TEXT,              -- streams_games.player_id 와 같은 익명 id
  game_id    TEXT,              -- 판과 상관없는 이벤트면 NULL
  seq        INTEGER NOT NULL,  -- 세션 안에서 0부터 늘어나는 순번
  type       TEXT NOT NULL,     -- session_start | hover | abandon | rematch …
  data       TEXT,              -- JSON (종류마다 다름, 1KB 이하)
  client     TEXT,              -- x-streams-client
  client_ts  INTEGER,           -- 클라이언트 시각 (epoch ms)
  created_at TEXT NOT NULL
);
CREATE INDEX streams_events_game ON streams_events (game_id);
CREATE INDEX streams_events_type ON streams_events (type, created_at);
