-- 177 — 목록 심층분석: 세션별 사용 모델 선택 저장.
-- 기존엔 org META gemini_model(flash-lite) 고정 → 대량 항목에서 RPM 429 다발 + 모델 선택 불가.
-- 세션에 선택 모델을 저장하면 러너·그룹핑·항목·종합이 모두 그 모델을 쓴다(NULL=org 기본값 폴백, 하위호환).
alter table ai_analysis_sessions
  add column if not exists model text;

comment on column ai_analysis_sessions.model is '이 세션 분석에 쓸 Gemini 모델. NULL이면 org META gemini_model 폴백.';
