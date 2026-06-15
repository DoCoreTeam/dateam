-- 095_seed_weekly_prompts.sql
-- D-4: 주간/일일→주간 프롬프트를 ai_prompts에 등록(거버넌스 가시화 + 어드민 수정 가능).
--   현재 코드 상수(gemini-refine.ts MERGE_BY_CATEGORY/WEEKLY_REFINE, gemini-daily-to-weekly)는 그대로 동작(무회귀).
--   런타임 DB-read 배선은 후속(DECISION-20260615-weekly-prompt-ssot). 본 마이그는 prompt_key 등록만.
-- 멱등: ON CONFLICT(prompt_key,version) DO NOTHING.

INSERT INTO ai_prompts (prompt_key, version, model_hint, content, active, source)
VALUES
  ('weekly.merge-by-category', 'v1-seed', 'gemini-2.0-flash',
   '여러 팀원의 주간보고를 구분(category) 의미통합 + 내용 병합·정제하여 팀 통합 보고로 작성. (코드 상수 MERGE_BY_CATEGORY_PROMPT와 동기화 대상 — 런타임 배선은 후속)',
   false, 'human'),
  ('weekly.refine', 'v1-seed', 'gemini-2.0-flash',
   '팀원 주간보고를 본부장 보고용으로 정비(오타·중복·포맷 통일, category 변경 금지). (코드 상수 WEEKLY_REFINE_PROMPT 동기화 대상)',
   false, 'human'),
  ('daily.to-weekly', 'v1-seed', 'gemini-2.0-flash',
   '일일업무 목록을 스타일가이드에 따라 주간보고(구분/성과/계획/이슈)로 변환. 지난주 구분 일관성 유지. (코드 generateWeeklyFromDailyTasks 동기화 대상)',
   false, 'human')
ON CONFLICT (prompt_key, version) DO NOTHING;

-- 롤백: DELETE FROM ai_prompts WHERE prompt_key IN ('weekly.merge-by-category','weekly.refine','daily.to-weekly') AND version='v1-seed';
