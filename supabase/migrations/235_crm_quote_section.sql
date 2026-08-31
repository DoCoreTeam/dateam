-- 235 · 견적 섹션 — 「1. 하드웨어 / 2. 구축 / 3. 유지보수」로 묶는다
--
-- 왜: 항목이 스무 줄 넘어가면 고객은 **무엇이 무엇인지 모른 채 총액만** 본다.
-- 실제 견적서는 거의 언제나 묶음으로 나가고, 묶음마다 소계가 붙는다.
-- 불변식 I1(`checkI1`)은 처음부터 섹션을 전제로 쓰여 있었는데 **표가 없어 죽은 코드**였다 —
-- 만들어 두고 소비 코드가 0인 그 상태다(v0.7.438 에서 반복 확인된 함정).
--
-- **섹션은 선택이다.** 지금 있는 견적은 전부 섹션이 없고, 없으면 예전과 똑같이 그려진다.
-- 그래서 sectionId 는 nullable 이고 기본값이 없다.
CREATE TABLE IF NOT EXISTS crm_quote_section (
  id            text PRIMARY KEY,
  "workspaceId" text NOT NULL REFERENCES crm_workspace(id) ON DELETE CASCADE,
  "quoteId"     text NOT NULL REFERENCES crm_quote(id) ON DELETE CASCADE,
  name          text NOT NULL,
  -- 인쇄 순서. 화면에서 끌어 옮기면 이 값이 바뀐다
  position      integer NOT NULL DEFAULT 0,
  -- 서버가 계산해 저장한다(라인 합계와 같은 이유 — 목록에서 다시 더하지 않게)
  "subtotalMinor" bigint NOT NULL DEFAULT 0,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE crm_quote_section IS
  '견적 안의 묶음. 섹션이 하나도 없으면 견적서는 예전처럼 한 표로 그려진다';

CREATE INDEX IF NOT EXISTS idx_quote_section_quote
  ON crm_quote_section("quoteId", position);

-- 견적이 지워지면 섹션도 함께 사라진다(소유 관계 — 관계·삭제 계약 R-1)
-- FK ON DELETE CASCADE 로 이미 걸었다.

-- 라인이 어느 묶음인지. **SET NULL 이 아니라 CASCADE 도 아니다** —
-- 섹션을 지워도 항목은 남아야 한다(묶음만 푸는 것이지 물건을 버리는 게 아니다).
ALTER TABLE crm_quote_line
  ADD COLUMN IF NOT EXISTS "sectionId" text;

ALTER TABLE crm_quote_line DROP CONSTRAINT IF EXISTS crm_quote_line_section_fk;
ALTER TABLE crm_quote_line
  ADD CONSTRAINT crm_quote_line_section_fk
  FOREIGN KEY ("sectionId") REFERENCES crm_quote_section(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_line_section ON crm_quote_line("sectionId");

COMMENT ON COLUMN crm_quote_line."sectionId" IS
  '어느 묶음인지. NULL 이면 묶이지 않은 항목 — 섹션 표 아래에 그대로 선다';
