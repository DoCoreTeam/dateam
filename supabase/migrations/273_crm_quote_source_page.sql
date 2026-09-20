-- 273_crm_quote_source_page.sql
--
-- 이 견적이 원본의 **어느 쪽**에서 왔는지, 그리고 그 쪽을 오려 둔 **조각**이 어느 첨부인지.
--
-- 왜: 한 파일에 견적이 두 건 들어 있으면 지금은 그 둘에 **같은 파일이 통째로** 붙는다.
-- 대조 화면은 1쪽부터 열리고, 사람이 그 안에서 자기 건을 찾아야 한다
-- (사용자 지적 2026-09-20: "pdf 올리니깐 거기 두개가 들어 있는데 찾아서 확인해야 하자나").
-- 쪽을 모르면 오릴 수도, 그 쪽을 열어 줄 수도 없다.
--
-- **넘겨짚지 않는다.** 쪽을 못 읽었으면 NULL 이고, NULL 이면 조각을 만들지 않고
-- 예전처럼 파일 전체를 연다. 틀린 쪽에서 오린 그림이 맞는 것처럼 보이는 것이
-- 안 오리는 것보다 나쁘다.
--
-- 보안(LOOP.md 7절 세 질문):
--   1 새 데이터를 저장하나 → 기존 표 crm_quote 에 칼럼 셋. **새 표가 아니다.**
--     그래서 CREATE TABLE ... AS 로 사본을 뜨는 일이 없고, RLS 는 이 표에 이미 켜져 있다
--     (259_anon_exposure_shutdown.sql). 새 정책을 만들지 않으므로 TO public 이 생길 자리도 없다.
--   2 새 창구를 여나 → 아니다. 읽기·쓰기는 기존 견적 창구 그대로다.
--   3 밖에서 온 값을 다루나 → 쪽 번호는 모델이 말한 값이라 밖에서 온 값이다.
--     그래서 정수로만 받고 **1 이상**만 허용한다(0 이나 음수가 들어오면 화면이
--     엉뚱한 쪽을 가리키거나 조각을 못 만든다). 검사는 앱과 DB 둘 다에서 한다.
--
-- 관계 종류(§R-1): sourceSnapshotId 는 첨부를 가리키지만 **FK 를 걸지 않는다.**
-- 첨부가 지워지면 조각이 없어지는 것이지 견적이 없어지는 것이 아니고, 그때는
-- 화면이 파일 전체로 물러선다. FK + CASCADE 를 걸면 첨부 정리가 견적을 건드린다.

ALTER TABLE crm_quote ADD COLUMN IF NOT EXISTS "sourcePageStart" INTEGER;
ALTER TABLE crm_quote ADD COLUMN IF NOT EXISTS "sourcePageEnd" INTEGER;
ALTER TABLE crm_quote ADD COLUMN IF NOT EXISTS "sourceSnapshotId" TEXT;

-- 0·음수 차단. 앱에서도 막지만, 막는 자리가 앱에만 있으면 다른 호출부가 생길 때 뚫린다
ALTER TABLE crm_quote DROP CONSTRAINT IF EXISTS chk_quote_source_page;
ALTER TABLE crm_quote
  ADD CONSTRAINT chk_quote_source_page
  CHECK (
    ("sourcePageStart" IS NULL OR "sourcePageStart" >= 1)
    AND ("sourcePageEnd" IS NULL OR "sourcePageEnd" >= 1)
    AND ("sourcePageStart" IS NULL OR "sourcePageEnd" IS NULL OR "sourcePageEnd" >= "sourcePageStart")
  );

COMMENT ON COLUMN crm_quote."sourcePageStart" IS
  '이 견적이 원본 파일의 몇 쪽에서 시작하나. NULL = 쪽을 못 읽었음(그때는 조각을 안 만들고 파일 전체를 연다)';
COMMENT ON COLUMN crm_quote."sourcePageEnd" IS
  '이 견적이 끝나는 쪽. 한 쪽에 다 들어가면 sourcePageStart 와 같다';
COMMENT ON COLUMN crm_quote."sourceSnapshotId" IS
  '그 쪽을 오려 둔 첨부(crm_attachment.id). FK 없음 — 첨부가 지워지면 화면이 파일 전체로 물러선다';
