-- ============================================================
-- 198_crm_core.sql — dacrm CRM 모듈 코어 스키마 (T0-02, dacrm v0.5.1)
--
-- 생성 방법 (손으로 쓰지 않았다. 재생성 가능하다)
--   prisma migrate diff --from-empty \
--     --to-schema-datamodel apps/web/prisma/schema.prisma --script
--
-- 안전성 (기존 205개 테이블에 장애를 주지 않는다)
--   - 순수 추가만: CREATE TABLE 24 · CREATE TYPE 16 · CREATE INDEX 36 · ADD CONSTRAINT 26
--   - DROP / TRUNCATE / DELETE / ALTER COLUMN / RENAME  0건
--   - crm_ 이외 테이블 언급 0건 (호스트 테이블은 이름조차 등장하지 않는다)
--   - scripts/migrate.sh 가 BEGIN/COMMIT 단일 트랜잭션 + ON_ERROR_STOP 로 적용하므로
--     중간 실패 시 전부 롤백된다(부분 적용 없음)
--   - 되돌리기: 24개 테이블 DROP + 16개 타입 DROP (기존 데이터와 무관)
--
-- 마지막 블록의 RLS 활성화는 Prisma 생성물이 아니라 이 파일에서 추가한 것이다.
--   왜: Supabase 는 public 스키마의 테이블을 PostgREST 로 자동 노출한다. 정책이 붙기 전
--   (199_crm_rls_check.sql) 까지 무방비로 두지 않기 위해 여기서 먼저 잠근다.
--   RLS 활성 + 정책 0개 = 전면 거부. service_role 과 postgres 는 BYPASSRLS 라 시드·마이그는 정상.
-- ============================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CrmMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'READONLY');

-- CreateEnum
CREATE TYPE "CrmLifecycleStage" AS ENUM ('LEAD', 'PROSPECT', 'CUSTOMER', 'PARTNER', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CrmDealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('EMAIL', 'MEETING', 'CALL', 'NOTE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CrmDataSource" AS ENUM ('HUMAN', 'AI', 'SYNC', 'IMPORT');

-- CreateEnum
CREATE TYPE "CrmTaskStatus" AS ENUM ('TODO', 'DOING', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "CrmRecordingStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmAiRunKind" AS ENUM ('MEETING_EXTRACT', 'QUICK_CREATE', 'ENRICH', 'FIELD_FILL', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "CrmAiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmSuggestionAxis" AS ENUM ('WHO', 'WHAT', 'WHERE', 'RISK', 'NEXT');

-- CreateEnum
CREATE TYPE "CrmSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'AUTO_APPLIED');

-- CreateEnum
CREATE TYPE "CrmDealContactRole" AS ENUM ('CHAMPION', 'DECISION_MAKER', 'PRACTITIONER', 'BLOCKER', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmSettingScope" AS ENUM ('GLOBAL', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "CrmActorType" AS ENUM ('HUMAN', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CrmDupStatus" AS ENUM ('PENDING', 'MERGED', 'DISMISSED');

-- CreateTable
CREATE TABLE "crm_workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'ko',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_member" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "role" "CrmMemberRole" NOT NULL DEFAULT 'MEMBER',
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_company" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "employeeRange" TEXT,
    "region" TEXT,
    "descriptionMd" TEXT,
    "ownerId" TEXT,
    "source" "CrmDataSource" NOT NULL DEFAULT 'HUMAN',
    "verifiedFields" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_person" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "lifecycleStage" "CrmLifecycleStage" NOT NULL DEFAULT 'LEAD',
    "memo" TEXT,
    "ownerId" TEXT,
    "source" "CrmDataSource" NOT NULL DEFAULT 'HUMAN',
    "verifiedFields" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "canvasJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_stage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmStageKind" NOT NULL DEFAULT 'OPEN',
    "position" INTEGER NOT NULL,
    "entryCriteriaJson" JSONB,

    CONSTRAINT "crm_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CrmDealStatus" NOT NULL DEFAULT 'OPEN',
    "amountMinor" BIGINT,
    "currency" CHAR(3),
    "expectedCloseDate" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "ownerId" TEXT,
    "healthScore" INTEGER,
    "source" "CrmDataSource" NOT NULL DEFAULT 'HUMAN',
    "verifiedFields" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_contact" (
    "dealId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "CrmDealContactRole" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_contact_pkey" PRIMARY KEY ("dealId","personId")
);

-- CreateTable
CREATE TABLE "crm_stage_history" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSec" INTEGER,

    CONSTRAINT "crm_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "companyId" TEXT,
    "personId" TEXT,
    "dealId" TEXT,
    "meetingId" TEXT,
    "gmailMessageId" TEXT,
    "raw" JSONB,
    "source" "CrmDataSource" NOT NULL DEFAULT 'HUMAN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'TODO',
    "dueAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "companyId" TEXT,
    "personId" TEXT,
    "dealId" TEXT,
    "sourceSuggestionId" TEXT,
    "createdById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "companyId" TEXT,
    "dealId" TEXT,
    "location" TEXT,
    "attendeesJson" JSONB NOT NULL DEFAULT '[]',
    "summaryMd" TEXT,
    "createdById" TEXT,
    "source" "CrmDataSource" NOT NULL DEFAULT 'HUMAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meeting_recording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "durationSec" INTEGER,
    "status" "CrmRecordingStatus" NOT NULL DEFAULT 'UPLOADED',
    "sttVendor" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_meeting_recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_transcript_segment" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "crm_transcript_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ai_run" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "CrmAiRunKind" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "CrmAiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "inputRef" JSONB NOT NULL,
    "outputJson" JSONB,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costMinorUsd" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_ai_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ai_suggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "axis" "CrmSuggestionAxis" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "field" TEXT,
    "currentValueJson" JSONB,
    "proposedValueJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "status" "CrmSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_ai_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ai_field_config" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.85,

    CONSTRAINT "crm_ai_field_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_duplicate_candidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" "CrmDupStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_duplicate_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_merge_log" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "survivorId" TEXT NOT NULL,
    "mergedId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "mergedById" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "crm_merge_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_app_setting" (
    "id" TEXT NOT NULL,
    "scope" "CrmSettingScope" NOT NULL,
    "workspaceId" TEXT,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_app_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ai_budget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "limitMinorUsd" BIGINT NOT NULL,
    "spentMinorUsd" BIGINT NOT NULL DEFAULT 0,
    "alertSentAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),

    CONSTRAINT "crm_ai_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_audit_log" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorType" "CrmActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_integration_connection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "gmailHistoryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_integration_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_exchange_rate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "base" CHAR(3) NOT NULL,
    "quote" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "crm_exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_member_workspaceId_email_idx" ON "crm_member"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "crm_member_workspaceId_hostUserId_key" ON "crm_member"("workspaceId", "hostUserId");

-- CreateIndex
CREATE INDEX "crm_company_workspaceId_name_idx" ON "crm_company"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "crm_company_workspaceId_updatedAt_idx" ON "crm_company"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_company_workspaceId_domain_key" ON "crm_company"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "crm_person_workspaceId_companyId_idx" ON "crm_person"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "crm_person_workspaceId_name_idx" ON "crm_person"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_person_workspaceId_email_key" ON "crm_person"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipeline_workspaceId_name_key" ON "crm_pipeline"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_stage_pipelineId_position_key" ON "crm_stage"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_stage_pipelineId_id_key" ON "crm_stage"("pipelineId", "id");

-- CreateIndex
CREATE INDEX "crm_deal_workspaceId_pipelineId_stageId_idx" ON "crm_deal"("workspaceId", "pipelineId", "stageId");

-- CreateIndex
CREATE INDEX "crm_deal_workspaceId_status_expectedCloseDate_idx" ON "crm_deal"("workspaceId", "status", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "crm_deal_workspaceId_ownerId_idx" ON "crm_deal"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "crm_stage_history_dealId_movedAt_idx" ON "crm_stage_history"("dealId", "movedAt");

-- CreateIndex
CREATE INDEX "crm_activity_workspaceId_occurredAt_idx" ON "crm_activity"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_activity_workspaceId_dealId_occurredAt_idx" ON "crm_activity"("workspaceId", "dealId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_activity_workspaceId_gmailMessageId_key" ON "crm_activity"("workspaceId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "crm_task_workspaceId_assigneeId_status_dueAt_idx" ON "crm_task"("workspaceId", "assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "crm_task_workspaceId_dealId_idx" ON "crm_task"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "crm_meeting_workspaceId_startedAt_idx" ON "crm_meeting"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "crm_meeting_workspaceId_dealId_idx" ON "crm_meeting"("workspaceId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_transcript_segment_recordingId_idx_key" ON "crm_transcript_segment"("recordingId", "idx");

-- CreateIndex
CREATE INDEX "crm_ai_run_workspaceId_createdAt_idx" ON "crm_ai_run"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_ai_run_workspaceId_kind_createdAt_idx" ON "crm_ai_run"("workspaceId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "crm_ai_suggestion_workspaceId_status_createdAt_idx" ON "crm_ai_suggestion"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "crm_ai_suggestion_workspaceId_targetType_targetId_idx" ON "crm_ai_suggestion"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ai_field_config_workspaceId_targetType_field_key" ON "crm_ai_field_config"("workspaceId", "targetType", "field");

-- CreateIndex
CREATE UNIQUE INDEX "crm_duplicate_candidate_workspaceId_targetType_aId_bId_key" ON "crm_duplicate_candidate"("workspaceId", "targetType", "aId", "bId");

-- CreateIndex
CREATE INDEX "crm_merge_log_workspaceId_mergedAt_idx" ON "crm_merge_log"("workspaceId", "mergedAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_app_setting_scope_workspaceId_key_key" ON "crm_app_setting"("scope", "workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "crm_ai_budget_workspaceId_month_key" ON "crm_ai_budget"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "crm_audit_log_workspaceId_createdAt_idx" ON "crm_audit_log"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_audit_log_workspaceId_targetType_targetId_idx" ON "crm_audit_log"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_integration_connection_workspaceId_memberId_provider_key" ON "crm_integration_connection"("workspaceId", "memberId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "crm_exchange_rate_date_base_quote_key" ON "crm_exchange_rate"("date", "base", "quote");

-- AddForeignKey
ALTER TABLE "crm_member" ADD CONSTRAINT "crm_member_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_company" ADD CONSTRAINT "crm_company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_person" ADD CONSTRAINT "crm_person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_person" ADD CONSTRAINT "crm_person_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline" ADD CONSTRAINT "crm_pipeline_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stage" ADD CONSTRAINT "crm_stage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "crm_pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "crm_pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_pipelineId_stageId_fkey" FOREIGN KEY ("pipelineId", "stageId") REFERENCES "crm_stage"("pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_contact" ADD CONSTRAINT "crm_deal_contact_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_contact" ADD CONSTRAINT "crm_deal_contact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "crm_person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "crm_person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "crm_meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting" ADD CONSTRAINT "crm_meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meeting_recording" ADD CONSTRAINT "crm_meeting_recording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "crm_meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_transcript_segment" ADD CONSTRAINT "crm_transcript_segment_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "crm_meeting_recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ai_run" ADD CONSTRAINT "crm_ai_run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ai_suggestion" ADD CONSTRAINT "crm_ai_suggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ai_suggestion" ADD CONSTRAINT "crm_ai_suggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "crm_ai_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_ai_budget" ADD CONSTRAINT "crm_ai_budget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "crm_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- RLS 선잠금 (Prisma 생성물 아님 — 위 헤더 참조). 정책은 199 에서.
-- ============================================================
ALTER TABLE "crm_workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_pipeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_stage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_deal_contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_meeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_meeting_recording" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_transcript_segment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_ai_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_ai_suggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_ai_field_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_duplicate_candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_merge_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_app_setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_ai_budget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_integration_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_exchange_rate" ENABLE ROW LEVEL SECURITY;
