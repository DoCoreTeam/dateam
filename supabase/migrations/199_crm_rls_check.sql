-- ============================================================
-- 199_crm_rls_check.sql — CRM RLS 정책 + CHECK 제약 (T0-03, dacrm v0.5.2)
-- 근거: 구현명세서 2.3
--
-- 명세와 달라진 점 2가지 (둘 다 실측 근거가 있다)
--
-- 1) 컬럼명이 snake_case 가 아니라 camelCase 다.
--    명세 2.3 은 workspace_id · end_ms · won_at · lost_reason · spent_minor_usd 로 썼지만,
--    crm_schema_v0.1.0.prisma 의 필드에 @map 이 없어 Prisma 가 필드명을 컬럼명으로 그대로 만든다.
--    실측(information_schema): "workspaceId" · "endMs" · "wonAt" · "lostReason" · "spentMinorUsd".
--    따라서 전부 큰따옴표 camelCase 로 쓴다. snake_case 로 쓰면 컬럼이 없어 즉시 실패한다.
--
-- 2) 정책을 "전 테이블 동일 문구"로 만들 수 없다. 24개 중 workspaceId 를 가진 것은 17개뿐이다.
--    - workspaceId NOT NULL 16개 : 직접 비교
--    - crm_app_setting            : workspaceId 가 nullable (GLOBAL 설정 행) → NULL 허용
--    - crm_workspace              : 자기 id 가 곧 워크스페이스
--    - crm_exchange_rate          : 테넌트 무관(TENANT_FREE, 명세 2.2)
--    - 자식 5개                    : 부모를 통해 판정 (stage→pipeline, deal_contact/stage_history→deal,
--                                   meeting_recording→meeting, transcript_segment→recording→meeting)
--    DO 블록으로 일괄 생성하면 이 차이가 뭉개져 잘못된 정책이 붙는다. 그래서 명시적으로 나열한다.
--
-- ⚠️ 알아 두어야 할 한계 — 이 RLS 는 Prisma 연결을 막지 못한다
--    실측: 이 DB 의 postgres 롤은 rolbypassrls = true 다. BYPASSRLS 는 FORCE ROW LEVEL SECURITY
--    보다 우선하므로, Prisma 가 postgres 로 붙는 한 정책은 적용되지 않는다.
--    따라서 이 파일의 RLS 가 실제로 지키는 것은 **PostgREST 경로(anon · authenticated)** 다.
--    Prisma 경로의 격리는 앱 계층 getCrmDb(workspaceId) 가드가 책임진다(T0-04).
--    DB 계층에서 Prisma 경로까지 막으려면 BYPASSRLS 가 없는 전용 롤이 필요하다 → T0-10 에서 다룬다.
--
--    그래서 여기서 REVOKE 를 함께 한다. CRM 은 PostgREST 를 쓰지 않으므로(전부 서버사이드 Prisma),
--    anon · authenticated 의 테이블 권한 자체를 회수하는 편이 정책보다 확실하다.
--    (Supabase 기본값이 public 스키마 신규 테이블에 두 롤 모두 전체 권한을 준다 — 실측 확인)
--
-- 안전성: 이 파일도 순수 추가다. 기존 205개 테이블은 이름조차 등장하지 않는다.
--         scripts/migrate.sh 가 BEGIN/COMMIT 단일 트랜잭션으로 적용한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1) CHECK 제약 4종 (명세 2.3-2)
-- ------------------------------------------------------------

-- 전사 구간은 끝이 시작보다 뒤여야 한다 (DI-23)
ALTER TABLE "crm_transcript_segment"
  ADD CONSTRAINT "chk_seg_time" CHECK ("endMs" > "startMs");

-- WON 은 성사일과 금액이 반드시 있어야 한다 (제품 원칙: 금액 없는 won 금지)
ALTER TABLE "crm_deal"
  ADD CONSTRAINT "chk_won"
  CHECK (status <> 'WON' OR ("wonAt" IS NOT NULL AND "amountMinor" IS NOT NULL));

-- LOST 는 사유가 반드시 있어야 한다
ALTER TABLE "crm_deal"
  ADD CONSTRAINT "chk_lost"
  CHECK (status <> 'LOST' OR "lostReason" IS NOT NULL);

-- 사용액은 음수가 될 수 없다
ALTER TABLE "crm_ai_budget"
  ADD CONSTRAINT "chk_budget" CHECK ("spentMinorUsd" >= 0);

-- ------------------------------------------------------------
-- 2) RLS 정책 (RLS 활성화 자체는 198 에서 이미 했다)
--    app.workspace_id 가 설정되지 않으면 current_setting 이 NULL 을 반환하고
--    비교식이 NULL 이 되어 어떤 행도 통과하지 못한다 = 기본 거부.
-- ------------------------------------------------------------

-- 2-1) workspaceId 를 직접 가진 테이블 16개
CREATE POLICY "crm_activity_tenant" ON "crm_activity" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_ai_budget_tenant" ON "crm_ai_budget" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_ai_field_config_tenant" ON "crm_ai_field_config" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_ai_run_tenant" ON "crm_ai_run" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_ai_suggestion_tenant" ON "crm_ai_suggestion" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_audit_log_tenant" ON "crm_audit_log" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_company_tenant" ON "crm_company" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_deal_tenant" ON "crm_deal" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_duplicate_candidate_tenant" ON "crm_duplicate_candidate" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_integration_connection_tenant" ON "crm_integration_connection" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_meeting_tenant" ON "crm_meeting" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_member_tenant" ON "crm_member" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_merge_log_tenant" ON "crm_merge_log" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_person_tenant" ON "crm_person" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_pipeline_tenant" ON "crm_pipeline" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE POLICY "crm_task_tenant" ON "crm_task" FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

-- 2-2) crm_app_setting — GLOBAL 설정은 workspaceId 가 NULL 이다 (명세 2.2 TENANT_FREE)
CREATE POLICY "crm_app_setting_tenant" ON "crm_app_setting" FOR ALL
  USING ("workspaceId" IS NULL OR "workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" IS NULL OR "workspaceId" = current_setting('app.workspace_id', true));

-- 2-3) crm_workspace — 자기 id 가 곧 워크스페이스 식별자
CREATE POLICY "crm_workspace_tenant" ON "crm_workspace" FOR ALL
  USING ("id" = current_setting('app.workspace_id', true))
  WITH CHECK ("id" = current_setting('app.workspace_id', true));

-- 2-4) crm_exchange_rate — 환율은 테넌트 무관 공용 데이터 (명세 2.2 TENANT_FREE)
CREATE POLICY "crm_exchange_rate_shared" ON "crm_exchange_rate" FOR ALL
  USING (true) WITH CHECK (true);

-- 2-5) 자식 테이블 5개 — 부모를 통해 판정한다
--      (부모 조회 자체도 부모의 정책을 타므로 격리가 이중으로 걸린다)

CREATE POLICY "crm_stage_tenant" ON "crm_stage" FOR ALL
  USING (EXISTS (SELECT 1 FROM "crm_pipeline" p
                  WHERE p."id" = "crm_stage"."pipelineId"
                    AND p."workspaceId" = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "crm_pipeline" p
                  WHERE p."id" = "crm_stage"."pipelineId"
                    AND p."workspaceId" = current_setting('app.workspace_id', true)));

CREATE POLICY "crm_deal_contact_tenant" ON "crm_deal_contact" FOR ALL
  USING (EXISTS (SELECT 1 FROM "crm_deal" d
                  WHERE d."id" = "crm_deal_contact"."dealId"
                    AND d."workspaceId" = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "crm_deal" d
                  WHERE d."id" = "crm_deal_contact"."dealId"
                    AND d."workspaceId" = current_setting('app.workspace_id', true)));

CREATE POLICY "crm_stage_history_tenant" ON "crm_stage_history" FOR ALL
  USING (EXISTS (SELECT 1 FROM "crm_deal" d
                  WHERE d."id" = "crm_stage_history"."dealId"
                    AND d."workspaceId" = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "crm_deal" d
                  WHERE d."id" = "crm_stage_history"."dealId"
                    AND d."workspaceId" = current_setting('app.workspace_id', true)));

CREATE POLICY "crm_meeting_recording_tenant" ON "crm_meeting_recording" FOR ALL
  USING (EXISTS (SELECT 1 FROM "crm_meeting" m
                  WHERE m."id" = "crm_meeting_recording"."meetingId"
                    AND m."workspaceId" = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "crm_meeting" m
                  WHERE m."id" = "crm_meeting_recording"."meetingId"
                    AND m."workspaceId" = current_setting('app.workspace_id', true)));

CREATE POLICY "crm_transcript_segment_tenant" ON "crm_transcript_segment" FOR ALL
  USING (EXISTS (SELECT 1 FROM "crm_meeting_recording" r
                  JOIN "crm_meeting" m ON m."id" = r."meetingId"
                  WHERE r."id" = "crm_transcript_segment"."recordingId"
                    AND m."workspaceId" = current_setting('app.workspace_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "crm_meeting_recording" r
                  JOIN "crm_meeting" m ON m."id" = r."meetingId"
                  WHERE r."id" = "crm_transcript_segment"."recordingId"
                    AND m."workspaceId" = current_setting('app.workspace_id', true)));

-- ------------------------------------------------------------
-- 3) FORCE RLS — 테이블 소유자에게도 정책을 적용한다
--    (BYPASSRLS 롤에는 효과가 없다. 위 한계 주석 참조 — 그래도 걸어 두는 편이 맞다:
--     BYPASSRLS 가 없는 롤로 붙는 순간부터 바로 격리가 동작한다)
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'crm\_%'
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4) PostgREST 노출 차단 — CRM 은 전부 서버사이드 Prisma 로만 접근한다
--    anon 키는 공개값(NEXT_PUBLIC_SUPABASE_ANON_KEY)이므로 권한 자체를 회수한다.
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'crm\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t);
  END LOOP;
END $$;
