-- 관리자 설정 (admin/ 에서 바꾸고, 게임 서버·실시간 통계가 읽는다). 게임마다 key 별로 JSON 값 하나.
--   streams / collect       true | false          — 끄면 게임은 되지만 기록·집계를 남기지 않는다
--   streams / public_cards  ["tiles","funnel",…]  — 공개 통계 페이지(/stats/streams/)에 보일 카드
-- 행이 없으면 기본값(수집 켬, 카드 전부 공개)이다.
CREATE TABLE site_settings (
  game       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,   -- JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT,            -- 바꾼 관리자 (Access 이메일)
  PRIMARY KEY (game, key)
);
