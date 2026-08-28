-- 228: 크레딧 충전 매출 + 종료일 미정
--
-- **왜 지금인가**: gcube 사이트에 크레딧을 충전하는 방식의 매출이 있다.
-- 회계로는 크레딧이 소진될 때까지 **선수금(부채)**이지만,
-- 영업 관점에서는 **수주이자 이미 수금된 매출**이다.
-- 지금 장부에는 그 자리가 없어 이 딜을 담을 수가 없다.
--
-- **이번에는 «영업 관점»만 담는다.** 소진에 따른 회계 인식(수익 실현)과
-- 수금 관리는 아직 구현하지 않는다 — 자리만 어긋나지 않게 열어 둔다.
--
-- 추가 전용(expand). 기존 행은 그대로 두고 NULL 로 시작한다(M-4).

-- ── 사업 유형에 크레딧 충전 ─────────────────────────────────
-- Postgres 는 enum 값 추가만 가능하고 삭제는 안 된다 — 그래서 신중히 하나만 더한다
ALTER TYPE "CrmBusinessType" ADD VALUE IF NOT EXISTS 'CREDIT';

-- ── 종료일이 «없는» 것과 «아직 모르는» 것을 구분한다 ──────────
--
-- 장기 크레딧 사업은 크레딧이 소진될 때까지가 기간이라 **종료일을 알 수 없다**.
-- endDate 를 NULL 로 두면 「아직 안 채웠다」와 구분이 안 되고,
-- 그러면 화면이 «채우라»고 계속 재촉하게 된다.
ALTER TABLE crm_deal
  ADD COLUMN IF NOT EXISTS "endDateUnknown" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN crm_deal."endDateUnknown" IS
  '종료일을 알 수 없는 사업(예: 크레딧 소진 시까지). NULL 인 endDate 가 «미입력»인지 «미정»인지 구분한다';
