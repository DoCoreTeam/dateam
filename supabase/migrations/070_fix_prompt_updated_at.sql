-- 066이 updated_at DEFAULT now()로 기존 프롬프트 수정일을 마이그레이션 시각으로 오염시킴 →
-- 실제 마지막 수정시각(생성일)으로 정정. 이후 진짜 편집 시에만 updated_at 갱신됨.
UPDATE public.ai_prompts SET updated_at = created_at, updated_by = NULL
WHERE updated_by IS NULL;
