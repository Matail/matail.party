-- 게임 상태가 암호화 토큰으로 클라이언트에 있으므로, 옛 토큰을 다시 보내 이미 둔 수를 바꿔 볼 수 있다.
-- 턴 기록은 처음 저장된 수를 유지하고, 같은 턴이 다시 들어올 때마다 attempts 를 올린다.
-- 분석할 때 attempts > 1 인 턴이 있는 게임은 제외한다.
ALTER TABLE streams_turns ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
