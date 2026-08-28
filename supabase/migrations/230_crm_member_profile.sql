-- 230: 견적서 담당자는 «회사 설정»이 아니라 «견적을 만든 사람»이다
--
-- 기획 「원가에서 견적까지」 §01 결정 3:
--   「영업대표 = 로그인 사용자 — 견적 생성 시 자동. 이름·직위·연락처는 프로필에서」
--
-- 그런데 프로필에 **직위와 연락처가 없어서**, 그 자리를 회사 설정
-- (`quote.supplier.contact`)으로 메워 놨었다. 그러면 견적서마다 담당이 같아진다 —
-- 누가 만들었든 「영업팀 대표번호」가 찍힌다.
--
-- 추가 전용(expand).

ALTER TABLE crm_member
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN crm_member.title IS '직위 — 견적서 담당자 줄에 이름과 함께 찍힌다';
COMMENT ON COLUMN crm_member.phone IS '연락처 — 고객이 이 사람에게 직접 건다';
