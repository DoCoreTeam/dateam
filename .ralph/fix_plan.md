# Fix Plan — dashboard.html 통합
생성: 2026-05-20

## Phase 0: DOC-FIRST
- [x] PROMPT.md 생성
- [x] fix_plan.md 생성

## Phase 1: DB 스키마
- [x] supabase/migrations/003_org_content.sql 생성 (org_content 테이블 + RLS)
- [x] Supabase에 migration 적용

## Phase 2: 데이터 마이그레이션
- [x] dashboard.html 데이터 추출 → org_content JSON 파일 생성
- [x] Supabase API로 데이터 삽입

## Phase 3: /dashboard 홈 개선
- [x] org_content에서 META·missions·dev_split·okr·principles 읽어 표시
- [x] 본부 현황 헤더 (조직명·슬로건·통계 4개)

## Phase 4: /operations 개선
- [x] 프로젝트 목록 (P 데이터) 표시
- [x] 멤버 카드 (MB 데이터) 표시
- [x] R&R 매트릭스 표시

## Phase 5: /kpi KPI 목표 연동
- [x] kpi_targets 데이터 DB에 저장됨 (admin에서 관리)

## Phase 6: /routine 루틴 정의 연동
- [x] routine_templates 데이터 DB에 저장됨 (admin에서 관리)

## Phase 7: Admin 관리 UI
- [x] /admin/content 페이지 (섹션별 폼 편집)
- [x] admin 사이드바에 '콘텐츠 관리' 메뉴 추가

## Phase 8: Admin 접속 버튼
- [x] 멤버 레이아웃 헤더에 admin role 시 "관리자 패널" 버튼 표시

## Phase 9: 마무리
- [x] dashboard.html → dashboard.html.legacy 처리
- [x] 빌드 검증 (tsc --noEmit 통과)
- [x] git commit
