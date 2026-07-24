-- 175 — 목록 심층분석 리치에디터 원본 보존 (R1-2, docs/2026-07-24-v0.7.378-...).
-- 리치에디터(Tiptap) 입력의 원본 HTML을 무손실 보존한다. source_text에는 마크다운 정규화본(표=파이프표)을
-- 계속 저장(AI·그룹핑·검색 SSOT). additive — 기존 세션은 source_format='plain'으로 자동 적재(무영향).
alter table ai_analysis_sessions
  add column if not exists source_html   text,
  add column if not exists source_format text not null default 'plain';

comment on column ai_analysis_sessions.source_html is '리치에디터 원본 HTML(무손실 보존). NULL=plain 입력.';
comment on column ai_analysis_sessions.source_format is '입력 형식: plain | html.';
