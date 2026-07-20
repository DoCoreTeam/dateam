-- 170_ai_analysis_grouping.sql
-- 목록 심층분석 v3 "의미 그룹핑" 재정의 — 157_ai_analysis_sessions.sql이 정의한
-- ai_analysis_sessions / ai_analysis_items 두 테이블을 ALTER ADD COLUMN으로만 확장.
-- 신규 테이블 없음. 157/161의 RLS 정책·트리거는 그대로 유지(재정의·삭제 금지).
-- 근거: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/01-architecture.md §2
--
-- 목적:
--   파이프라인 ①문서유형판정 ②구조트리복원(결정론) ③그룹절단(AI) ④그룹조립+유실검증(결정론)
--   ⑤넓이패스 ⑥그룹별재가공 ⑦정합패스 를 지원하기 위한 데이터 모델 확장.
--   ai_analysis_items의 의미가 "추출 항목(1줄)"에서 "그룹(원문 슬라이스 전체)"으로 재정의된다.
--
--   - doc_type/doc_type_source: ① 문서 유형 판정 결과(AI 판정 또는 사용자 지시 명시).
--   - doc_meta: ⑤ 본문에서 분리된 문서 속성(버전/작성일/상태/작성자 등) — 배열, 제외가 아니라 별도 보관.
--   - structure_tree: ② 헤딩/번호/들여쓰기로 복원한 원문 구조 트리.
--   - grouping_revision: ③④ 재그룹핑(재지시) 시마다 +1. 세션당 현재 활성 리비전.
--   - unassigned_lines: ④ 유실 0 검증 결과 — 그룹/메타 어디에도 귀속되지 않은 원문 줄(정상 시 빈 배열).
--   - ai_analysis_items 확장(항목 → 그룹):
--     revision(소속 그룹핑 리비전) · title(그룹 제목, 기존 item_text 승계 의미는 코드단에서 매핑) ·
--     body_raw(원문 슬라이스 전체, 재작성 금지 원칙의 근거) · source_span(원문 내 {start,end} 오프셋) ·
--     tree_path(문서 내 위치, 예 "1.2.3") · depth(계층 레벨) · origin(그룹 출처: 구조복원/넓이패스/사용자).
--
-- 전부 additive(IF NOT EXISTS) + 기본값으로 기존 행 안전. 기존 행 0건이라 백필 불요.
-- 마이그레이션 적용은 CEO가 별도 수행 — 이 파일은 작성만.

-- ── ai_analysis_sessions 확장 ──────────────────────────────────────────────
alter table ai_analysis_sessions
  add column if not exists doc_type text;

alter table ai_analysis_sessions
  add column if not exists doc_type_source text not null default 'ai'
  check (doc_type_source in ('ai', 'instruction'));

alter table ai_analysis_sessions
  add column if not exists doc_meta jsonb not null default '[]'::jsonb;

alter table ai_analysis_sessions
  add column if not exists structure_tree jsonb;

alter table ai_analysis_sessions
  add column if not exists grouping_revision integer not null default 1;

alter table ai_analysis_sessions
  add column if not exists unassigned_lines jsonb not null default '[]'::jsonb;

-- ── ai_analysis_items 확장 (의미: 항목 → 그룹) ───────────────────────────────
alter table ai_analysis_items
  add column if not exists revision integer not null default 1;

alter table ai_analysis_items
  add column if not exists title text not null default '';

alter table ai_analysis_items
  add column if not exists body_raw text not null default '';

alter table ai_analysis_items
  add column if not exists source_span jsonb;

alter table ai_analysis_items
  add column if not exists tree_path text not null default '';

alter table ai_analysis_items
  add column if not exists depth integer not null default 0;

alter table ai_analysis_items
  add column if not exists origin text not null default 'structure'
  check (origin in ('structure', 'breadth', 'user'));

-- 조회 최적화: 세션의 특정 리비전 그룹을 idx 순으로 나열
create index if not exists idx_aiai_session_revision
  on ai_analysis_items (session_id, revision, idx);
