-- 축6: 변경 이력에 "무엇을 바꿨는지"(before→after) 보이게 — revision에 diff 요약 + 이전 본문 스냅샷 저장.
ALTER TABLE public.ai_prompt_revisions ADD COLUMN IF NOT EXISTS diff_summary text;
ALTER TABLE public.ai_prompt_revisions ADD COLUMN IF NOT EXISTS prev_content text;
