-- 축6: gpu_audit_logs action_type CHECK에 AI 프롬프트 거버넌스 이벤트 추가(감사 기록 가능하게).
ALTER TABLE public.gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE public.gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check CHECK (action_type = ANY (ARRAY[
  'quote_registered','quote_confirmed','lowest_changed','expired','direct_set','margin_changed','rejected',
  'review_created','review_finalized','review_rejected','review_recheck_completed','pool_stock_changed',
  'availability_registered','inquiry_sent',
  'ai_prompt_auto_activated','ai_prompt_auto_rolled_back','ai_prompt_rolled_back','ai_prompt_edited',
  'ai_prompt_held','ai_prompt_activated','ai_prompt_deactivated'
]));
