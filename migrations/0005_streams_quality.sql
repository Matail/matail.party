-- 데이터 품질 규칙 (docs/streams-unity-plan.md 2단계): 학습·분석에 넣을 판을 고르는 규칙을 뷰 한 곳에 둔다.
-- 내보내기·분석은 원본 테이블 대신 이 뷰를 읽는다. 뷰라서 원본 기록은 바뀌지 않는다.
--
-- 학습에 넣는 판
--   · 끝난 판 (20턴이 다 기록됨)
--   · AI 대전 (mode = 'ai')
--   · 에디터·로컬 테스트 판이 아님 (client 'unity-editor/…')
--   · 옛 토큰으로 다시 둔 턴(attempts > 1)이 없음
-- 표시만 하는 것 (빼지 않음)
--   · 생각 시간 이상치: 기록이 없거나 10분(600000ms)을 넘김 — 자리를 비운 것
--   · 클라이언트 종류 (web · unity-webgl …) — 두는 방식을 비교하거나 학습 때 구분 변수로

CREATE VIEW streams_clean_games AS
SELECT
  g.id, g.player_id, g.level, g.ai_model, g.mode, g.client,
  CASE WHEN instr(g.client, '/') > 0 THEN substr(g.client, 1, instr(g.client, '/') - 1) END AS client_kind,
  g.deck, g.player_board, g.ai_board, g.player_score, g.ai_score, g.created_at, g.finished_at,
  (SELECT max(t.think_ms) FROM streams_turns t WHERE t.game_id = g.id) AS max_think_ms,
  EXISTS (SELECT 1 FROM streams_turns t WHERE t.game_id = g.id AND (t.think_ms IS NULL OR t.think_ms > 600000)) AS has_slow_turn
FROM streams_games g
WHERE g.status = 'finished'
  AND g.mode = 'ai'
  AND (g.client IS NULL OR g.client NOT LIKE 'unity-editor/%')
  AND NOT EXISTS (SELECT 1 FROM streams_turns t WHERE t.game_id = g.id AND t.attempts > 1)
  AND (SELECT count(*) FROM streams_turns t WHERE t.game_id = g.id) = 20;

CREATE VIEW streams_clean_turns AS
SELECT
  t.game_id, t.turn, t.card, t.player_slot, t.ai_slot, t.think_ms,
  (t.think_ms IS NULL OR t.think_ms > 600000) AS slow_turn,
  g.level, g.ai_model, g.client_kind, g.player_id, t.created_at
FROM streams_turns t
JOIN streams_clean_games g ON g.id = t.game_id;
