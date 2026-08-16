-- ============================================================
-- 201_crm_partial_unique.sql — 유니크 제약을 부분 인덱스로 (dacrm v0.5.12)
-- 근거: 통합기획서 v0.2.1
--   632행 "유니크 제약은 전부 부분 인덱스(deleted_at IS NULL 조건)로 선언해 휴지통과 충돌 방지"
--   533행 company "(workspace_id, lower(domain)) 부분 유니크(도메인 존재 시)"
--   534행 person  "(workspace_id, lower(email)) 부분 유니크"
--   473행 "소프트 삭제 기본: deleted_at 컬럼, 30일 보관 후 하드 삭제 배치, 휴지통 복구 제공"
--
-- 무엇이 문제였나 (실제 결함이다)
--   Prisma 의 @@unique 는 전체 유니크 인덱스를 만든다. 그래서 지금 상태에서는
--   회사를 휴지통에 버린 뒤 **같은 도메인으로 다시 만들 수 없다.**
--   사용자 눈에는 "지웠는데 왜 못 만들지"로 보이고, 원인이 휴지통에 있다는 걸 알 방법이 없다.
--   이메일(인물)·파이프라인 이름·멤버도 같다.
--
--   그리고 대소문자. 지금은 Data-Alliance.com 과 data-alliance.com 이 서로 다른 회사가 된다.
--   앱이 소문자로 정규화해도 그건 앱의 약속일 뿐이고, 임포트·이관·직접 SQL 이 우회한다.
--   기획서가 lower() 유니크를 요구한 이유다.
--
-- 안전성
--   - 기존 crm_ 인덱스만 교체한다. 호스트 205개 테이블은 이름조차 등장하지 않는다.
--   - 제약을 **좁히는** 방향이 아니라 **넓히는** 방향이다(삭제된 행을 유니크 판정에서 제외).
--     따라서 기존 데이터가 새 제약을 위반할 수 없다. 단 lower() 는 좁히는 쪽이라
--     아래에서 위반 여부를 먼저 확인하고, 있으면 마이그레이션이 실패해 롤백된다.
--   - scripts/migrate.sh 가 단일 트랜잭션으로 적용한다.
--
-- Prisma 스키마와의 관계
--   Prisma 는 부분·함수 유니크 인덱스를 표현하지 못한다. 그래서 schema.prisma 에서
--   해당 @@unique 를 @@index 로 바꿨다(조회 성능은 유지, 유일성은 DB 가 지킨다).
--   결과적으로 Prisma 의 복합 unique 헬퍼(where: { workspaceId_domain: ... })는 쓸 수 없다.
--   findFirst 로 조회하고, upsert 는 id 기준으로 한다.
-- ============================================================

-- ------------------------------------------------------------
-- 0) lower() 로 좁히기 전에 위반이 있는지 먼저 본다.
--    있으면 여기서 예외를 던져 트랜잭션 전체가 롤백된다(부분 적용 없음).
-- ------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT "workspaceId", lower(domain) d
      FROM "crm_company"
     WHERE domain IS NOT NULL AND "deletedAt" IS NULL
     GROUP BY 1, 2 HAVING count(*) > 1
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION '대소문자만 다른 회사 도메인이 % 쌍 있습니다. 먼저 병합해야 합니다.', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "workspaceId", lower(email) e
      FROM "crm_person"
     WHERE email IS NOT NULL AND "deletedAt" IS NULL
     GROUP BY 1, 2 HAVING count(*) > 1
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION '대소문자만 다른 인물 이메일이 % 쌍 있습니다. 먼저 병합해야 합니다.', n;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1) 회사 도메인 — (workspaceId, lower(domain)), 도메인 존재 + 미삭제
-- ------------------------------------------------------------
ALTER TABLE "crm_company" DROP CONSTRAINT IF EXISTS "crm_company_workspaceId_domain_key";
DROP INDEX IF EXISTS "crm_company_workspaceId_domain_key";
CREATE UNIQUE INDEX "crm_company_ws_domain_uniq"
  ON "crm_company" ("workspaceId", lower(domain))
  WHERE domain IS NOT NULL AND "deletedAt" IS NULL;

-- ------------------------------------------------------------
-- 2) 인물 이메일 — (workspaceId, lower(email)), 이메일 존재 + 미삭제
-- ------------------------------------------------------------
ALTER TABLE "crm_person" DROP CONSTRAINT IF EXISTS "crm_person_workspaceId_email_key";
DROP INDEX IF EXISTS "crm_person_workspaceId_email_key";
CREATE UNIQUE INDEX "crm_person_ws_email_uniq"
  ON "crm_person" ("workspaceId", lower(email))
  WHERE email IS NOT NULL AND "deletedAt" IS NULL;

-- ------------------------------------------------------------
-- 3) 멤버 — 같은 사람을 다시 초대할 수 있어야 한다(내보낸 뒤 재초대)
-- ------------------------------------------------------------
ALTER TABLE "crm_member" DROP CONSTRAINT IF EXISTS "crm_member_workspaceId_hostUserId_key";
DROP INDEX IF EXISTS "crm_member_workspaceId_hostUserId_key";
CREATE UNIQUE INDEX "crm_member_ws_host_uniq"
  ON "crm_member" ("workspaceId", "hostUserId")
  WHERE "deletedAt" IS NULL;

-- ------------------------------------------------------------
-- 4) 파이프라인 이름 — 지운 이름을 다시 쓸 수 있어야 한다
-- ------------------------------------------------------------
ALTER TABLE "crm_pipeline" DROP CONSTRAINT IF EXISTS "crm_pipeline_workspaceId_name_key";
DROP INDEX IF EXISTS "crm_pipeline_workspaceId_name_key";
CREATE UNIQUE INDEX "crm_pipeline_ws_name_uniq"
  ON "crm_pipeline" ("workspaceId", name)
  WHERE "deletedAt" IS NULL;

-- ------------------------------------------------------------
-- 5) Gmail 멱등 키 — 활동은 소프트 삭제되면 같은 메일을 다시 담을 수 있어야 한다(DI-21)
-- ------------------------------------------------------------
ALTER TABLE "crm_activity" DROP CONSTRAINT IF EXISTS "crm_activity_workspaceId_gmailMessageId_key";
DROP INDEX IF EXISTS "crm_activity_workspaceId_gmailMessageId_key";
CREATE UNIQUE INDEX "crm_activity_ws_gmail_uniq"
  ON "crm_activity" ("workspaceId", "gmailMessageId")
  WHERE "gmailMessageId" IS NOT NULL AND "deletedAt" IS NULL;

-- ------------------------------------------------------------
-- 6) 소프트 삭제 조회 성능 — 목록은 항상 deletedAt IS NULL 로 거른다
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "crm_company_ws_live_idx"
  ON "crm_company" ("workspaceId", "updatedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "crm_person_ws_live_idx"
  ON "crm_person" ("workspaceId", "name") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "crm_deal_ws_live_idx"
  ON "crm_deal" ("workspaceId", "status", "expectedCloseDate") WHERE "deletedAt" IS NULL;
