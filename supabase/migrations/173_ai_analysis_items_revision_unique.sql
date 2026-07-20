-- 173_ai_analysis_items_revision_unique.sql
-- 목록 심층분석 재정의 — 재그룹핑(리비전) 지원을 위한 유니크 제약 교체.
--
-- 문제:
--   157이 만든 unique(session_id, idx)는 "세션당 항목 집합은 1벌"이라는 v1 가정의 산물이다.
--   그런데 170에서 revision을 도입해 재그룹핑(사용자가 "더 크게 묶어" 재지시 → 새 리비전)을
--   지원하게 됐고, 새 리비전은 idx를 0부터 다시 매긴다. 기존 제약 아래서는
--   regroupSession의 두 번째 insert가 반드시 23505(unique violation)로 실패한다.
--   → 재지시 루프는 이번 재정의의 핵심 기능이므로 제약을 리비전 포함으로 교체한다.
--
-- 안전성:
--   - ADD(신규 유니크) → DROP(구 유니크) 순서. 신규 제약이 구 제약보다 느슨하므로
--     기존 행이 있어도 신규 생성이 먼저 성공한다(구 제약을 만족하면 신규도 자동 만족).
--   - 현재 ai_analysis_items 행 수는 0이지만, 행이 있어도 안전한 순서로 작성했다.

-- 1) 신규 유니크 먼저 생성 (revision 포함)
alter table ai_analysis_items
  add constraint ai_analysis_items_session_revision_idx_key
  unique (session_id, revision, idx);

-- 2) 구 유니크 제거 — 이제 리비전별로 idx가 0부터 다시 시작할 수 있다
alter table ai_analysis_items
  drop constraint if exists ai_analysis_items_session_id_idx_key;
