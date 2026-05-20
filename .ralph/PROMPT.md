# Ralph Loop — dashboard.html → Next.js 완전 통합
생성일: 2026-05-20
버전: v0.2.0

## 목표
dashboard.html(7탭 · 14종 데이터)을 Next.js DB 시스템에 완전 흡수:
홈 표시 + 기능 페이지 연동 + admin 관리 전환 + HTML 파일 퇴역

## 완료 기준 (Completion Criteria)

### [사용자 정의 종료조건]
1. [ ] dashboard.html의 모든 콘텐츠가 DB에 저장되고 Next.js 화면에서 보임
2. [ ] 각 데이터가 해당 기능 페이지에 연동됨 (KPI→/kpi, 루틴→/routine, 프로젝트→/operations)
3. [ ] Admin이 admin 패널에서 모든 항목 수정 가능
4. [ ] dashboard.html은 더 이상 사용되지 않음 (레거시 처리)

### [시스템 필수 조건]
5. [ ] fix_plan.md의 모든 항목이 [x]로 체크됨
6. [ ] 빌드 에러 없음 (tsc --noEmit 통과)
7. [ ] GATE 1-5 전부 통과

## 제약사항
- 기존 tables(profiles, weekly_reports, kpi_entries, routine_checks) 구조 변경 금지
- RLS 필수 구현
- admin 전용 데이터 수정 (일반 멤버 읽기 전용)

## 데이터 카테고리 매핑
| 키 | 내용 | 표시 위치 |
|----|------|----------|
| META | 본부 기본 정보, 통계 4개 | /dashboard 홈 헤더 |
| projects (P) | 12개 프로젝트 | /operations |
| members (MB) | 4명 멤버 상세 | /operations |
| rr (RR) | R&R 매트릭스 | /operations |
| missions (M) | 9개 미션 | /dashboard 홈 |
| dev_split (DS) | 개발 비중 | /dashboard 홈 |
| okr (O) | OKR 4개 | /dashboard 홈 |
| principles (PR) | 8개 원칙 | /dashboard 홈 |
| rhythm (RH+RB) | 정기 리듬 | /dashboard 홈 |
| kpi_targets (KC+WK) | KPI 목표 | /kpi 보조 |
| routine_templates (RT) | 멤버별 루틴 정의 | /routine 보조 |
