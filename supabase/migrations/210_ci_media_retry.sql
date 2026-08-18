-- 210_ci_media_retry.sql — 영상 읽기 재시도 기록
--
-- 왜 필요한가 (209 직후 실측에서 드러난 설계 구멍):
-- 209는 "실패해도 행은 남긴다"고 정했다. 무엇으로 시도했고 왜 안 됐는지가 화면에 떠야
-- 사용자가 고장과 한계를 구분할 수 있기 때문이다. 그 판단은 지금도 맞다.
--
-- 그런데 그 행의 존재가 곧 "이미 읽었다"로 읽혔다. 그래서 **일시적 실패**(쿼터 429·타임아웃)로
-- 한 번 실패한 게시물은 영원히 다시 시도되지 않았다 — 실측 57건 중 32건이 429로 실패한 뒤
-- 재시도 대상에서 통째로 빠져 있었다. 화면에는 "영상을 읽지 못함"이 영구히 남는다.
--
-- 고침: "행이 있다"와 "읽어냈다"를 분리한다.
--   읽어낸 것이 있으면      → 다시 읽지 않는다
--   못 읽었고 시도가 남았으면 → 다시 읽는다
--   시도를 다 썼으면        → 포기하고 이유를 남긴다 (무한 재시도로 돈을 태우지 않는다)

ALTER TABLE ci_content_media
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error    text;

-- 밀린 재시도를 싸게 찾기 위한 인덱스. 성공한 행은 대상이 아니므로 조건에서 뺀다.
CREATE INDEX IF NOT EXISTS idx_ci_media_retry
  ON ci_content_media (workspace_id, attempt_count)
  WHERE transcript IS NULL AND topic_guess IS NULL;

COMMENT ON COLUMN ci_content_media.attempt_count IS
  '영상 읽기를 시도한 횟수. 실패해도 행이 남으므로, 재시도 여부는 행의 존재가 아니라 이 값과 성과로 정한다.';
COMMENT ON COLUMN ci_content_media.last_error IS
  '마지막 실패 사유. 429(쿼터)·타임아웃은 일시적이라 다시 시도하고, 비공개·삭제는 시도를 다 쓰면 포기한다.';
