-- supabase/tests/crm_constraints_negative.sql
-- CRM 제약이 실제로 거부하는지 확인하는 음성 테스트 (dacrm T0-03).
-- 전부 ROLLBACK 하므로 운영 데이터에 흔적을 남기지 않는다. 실행:
--   PGPASSWORD=... psql -h <pooler> -p 6543 -U postgres.<ref> -d postgres -q -f supabase/tests/crm_constraints_negative.sql
-- 기대: [1][2][3][4][5] 에서 ERROR 가 나야 정상. [1b][6] 은 오류가 없어야 정상.

\set ON_ERROR_STOP off
BEGIN;
-- 최소 부모 체인
INSERT INTO "crm_workspace"("id","name","updatedAt") VALUES ('ws_t','테스트WS',now());
INSERT INTO "crm_company"("id","workspaceId","name","updatedAt") VALUES ('co_t','ws_t','테스트회사',now());
INSERT INTO "crm_pipeline"("id","workspaceId","name") VALUES ('pl_t','ws_t','테스트파이프');
INSERT INTO "crm_stage"("id","pipelineId","name","position") VALUES ('st_t','pl_t','제안',1);
INSERT INTO "crm_meeting"("id","workspaceId","title","startedAt","updatedAt") VALUES ('mt_t','ws_t','회의',now(),now());
INSERT INTO "crm_meeting_recording"("id","meetingId","fileUrl") VALUES ('rc_t','mt_t','crm/test.m4a');

\echo '--- [1] chk_seg_time: endMs <= startMs 는 거부되어야 한다'
SAVEPOINT s1;
INSERT INTO "crm_transcript_segment"("id","recordingId","idx","speaker","startMs","endMs","text")
VALUES ('sg_bad','rc_t',1,'화자1',5000,5000,'같은 시각');
ROLLBACK TO s1;

\echo '--- [1b] 정상 구간은 통과해야 한다'
SAVEPOINT s1b;
INSERT INTO "crm_transcript_segment"("id","recordingId","idx","speaker","startMs","endMs","text")
VALUES ('sg_ok','rc_t',1,'화자1',5000,7000,'정상');
ROLLBACK TO s1b;

\echo '--- [2] chk_won: WON 인데 wonAt/amountMinor 없음 → 거부'
SAVEPOINT s2;
INSERT INTO "crm_deal"("id","workspaceId","companyId","pipelineId","stageId","name","status","updatedAt")
VALUES ('dl_bad1','ws_t','co_t','pl_t','st_t','금액없는 성사','WON',now());
ROLLBACK TO s2;

\echo '--- [3] chk_lost: LOST 인데 lostReason 없음 → 거부'
SAVEPOINT s3;
INSERT INTO "crm_deal"("id","workspaceId","companyId","pipelineId","stageId","name","status","updatedAt")
VALUES ('dl_bad2','ws_t','co_t','pl_t','st_t','사유없는 실주','LOST',now());
ROLLBACK TO s3;

\echo '--- [4] chk_budget: spentMinorUsd 음수 → 거부'
SAVEPOINT s4;
INSERT INTO "crm_ai_budget"("id","workspaceId","month","limitMinorUsd","spentMinorUsd")
VALUES ('bg_bad','ws_t','2026-08',10000,-1);
ROLLBACK TO s4;

\echo '--- [5] 복합FK: 다른 파이프라인의 스테이지를 딜에 붙이면 거부 (DI-05)'
SAVEPOINT s5;
INSERT INTO "crm_pipeline"("id","workspaceId","name") VALUES ('pl_t2','ws_t','다른파이프');
INSERT INTO "crm_deal"("id","workspaceId","companyId","pipelineId","stageId","name","updatedAt")
VALUES ('dl_bad3','ws_t','co_t','pl_t2','st_t','파이프 불일치',now());
ROLLBACK TO s5;

\echo '--- [6] 정상 OPEN 딜은 통과해야 한다'
SAVEPOINT s6;
INSERT INTO "crm_deal"("id","workspaceId","companyId","pipelineId","stageId","name","updatedAt")
VALUES ('dl_ok','ws_t','co_t','pl_t','st_t','정상 딜',now());
ROLLBACK TO s6;

ROLLBACK;