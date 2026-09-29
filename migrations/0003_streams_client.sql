-- 어떤 클라이언트로 둔 판인지 (x-streams-client 헤더). 예: web/1, unity-webgl/0.1.0
-- 이 컬럼 이전의 판과 헤더를 안 보낸 판은 NULL.
ALTER TABLE streams_games ADD COLUMN client TEXT;
