-- AIMBOOSTER 판 기록 (Unity 클라이언트, docs/aimbooster-api.md). 판정은 클라이언트가 하고, 서버는 끝난 판의 요약이
-- 규칙상 가능한지 검사한다 — 의심스러운 판도 지우지 않고 suspect = 1 과 사유를 남긴다 (공개 집계 · 상위 % 에서만 뺀다).
CREATE TABLE aim_runs (
  id              TEXT PRIMARY KEY,
  player_id       TEXT,                       -- 기기에 저장한 익명 id
  client          TEXT,                       -- x-aimbooster-client (unity-webgl/0.1.0 …)
  seed            INTEGER,                    -- 과녁 자리 시드 (클라이언트가 정해 보낸다)
  rules_version   INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'playing',   -- playing | finished
  duration_ms     INTEGER,                    -- 버틴 시간 = 점수
  shots           INTEGER,
  hits            INTEGER,
  misses          INTEGER,
  spawned         INTEGER,
  max_level       INTEGER,
  reaction_med_ms INTEGER,                    -- 서버가 reactionsMs 로 다시 계산한 값
  reaction_p90_ms INTEGER,
  summary         TEXT,                       -- 받은 요약 JSON 전체 (반응 시간 · 벽별 기록 포함)
  suspect         INTEGER NOT NULL DEFAULT 0,
  suspect_reasons TEXT,                       -- 검사에 걸린 사유 (JSON 배열)
  created_at      TEXT NOT NULL,
  finished_at     TEXT
);

CREATE INDEX aim_runs_created ON aim_runs (created_at);
CREATE INDEX aim_runs_player ON aim_runs (player_id);

-- 분석 · 공개 집계에 쓰는 판: 끝났고, 의심 판이 아니고, 에디터 테스트(unity-editor/…)가 아님
CREATE VIEW aim_clean_runs AS
SELECT *
FROM aim_runs
WHERE status = 'finished'
  AND suspect = 0
  AND (client IS NULL OR client NOT LIKE 'unity-editor/%');
