-- 161_ai_analysis_v2.sql
-- 목록 심층분석(/ai-chat/analyze) v2 확장 — 157_ai_analysis_sessions.sql이 정의한
-- ai_analysis_sessions / ai_analysis_items 두 테이블을 ALTER ADD COLUMN으로만 확장.
-- 신규 테이블 없음. 157의 RLS 정책·트리거는 그대로 유지(재정의·삭제 금지).
--
-- 목적:
--   - command/phase/control: 사용자 자유 명령이 3단계(추출→분석→종합) 프롬프트를 지배하고,
--     서버 주도 진행상태(phase)와 사용자 임의중단(control)을 분리 관리(resume 복원 가능).
--   - run_claimed_at/cron_managed: 오케스트레이터 이중실행 방지 락 + 백그라운드 크론 위임 여부.
--   - synth_status/synth_text: 기존에 영속화되지 않던 "종합" 결과를 저장 — 브라우저 종료 시
--     종합 결과가 유실되는 사각을 해소.
--   - coverage: 추출 커버리지 리포트(total/covered/missing/appended)를 세션에 영속.
--   - ai_analysis_items 확장: 원문 앵커(context_excerpt/span_start/span_end)·AI 의도 주석
--     (intent_note)·취합용 다이제스트 캐시(digest_text)·재시도/실패 추적(error_text·attempts)·
--     클레임 기반 stall 감지(claimed_at·started_at·finished_at)·항목별 토큰 비용
--     (prompt_tokens·output_tokens).
--
-- 전부 additive(IF NOT EXISTS) + 기본값으로 기존 행 안전. 마이그레이션 적용은 CEO가 별도 수행.

-- ── ai_analysis_sessions 확장 ──────────────────────────────────────────────
alter table ai_analysis_sessions
  add column if not exists command text not null default '';

alter table ai_analysis_sessions
  add column if not exists phase text not null default 'idle';

alter table ai_analysis_sessions
  add column if not exists control text not null default 'running'
  check (control in ('running', 'paused', 'cancelled'));

alter table ai_analysis_sessions
  add column if not exists run_claimed_at timestamptz;

alter table ai_analysis_sessions
  add column if not exists cron_managed boolean not null default false;

alter table ai_analysis_sessions
  add column if not exists synth_status text not null default 'pending'
  check (synth_status in ('pending', 'running', 'done', 'error'));

alter table ai_analysis_sessions
  add column if not exists synth_text text;

alter table ai_analysis_sessions
  add column if not exists coverage jsonb;

-- ── ai_analysis_items 확장 ──────────────────────────────────────────────────
alter table ai_analysis_items
  add column if not exists context_excerpt text;

alter table ai_analysis_items
  add column if not exists intent_note text;

alter table ai_analysis_items
  add column if not exists span_start integer;

alter table ai_analysis_items
  add column if not exists span_end integer;

alter table ai_analysis_items
  add column if not exists digest_text text;

alter table ai_analysis_items
  add column if not exists error_text text;

alter table ai_analysis_items
  add column if not exists attempts integer not null default 0;

alter table ai_analysis_items
  add column if not exists claimed_at timestamptz;

alter table ai_analysis_items
  add column if not exists started_at timestamptz;

alter table ai_analysis_items
  add column if not exists finished_at timestamptz;

alter table ai_analysis_items
  add column if not exists prompt_tokens integer;

alter table ai_analysis_items
  add column if not exists output_tokens integer;

-- claim 스캔 최적화: 오케스트레이터가 pending/running 항목만 골라 재claim/stall 감지
create index if not exists idx_aiai_claim
  on ai_analysis_items (session_id, status)
  where status in ('pending', 'running');
