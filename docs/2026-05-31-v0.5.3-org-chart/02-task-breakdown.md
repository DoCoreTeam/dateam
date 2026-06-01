# 태스크 분해

## Phase 0: DB
- [ ] 037_org_chart.sql 마이그레이션 작성
- [ ] psql로 적용

## Phase 1: 어드민 구현
- [ ] actions.ts (회사·부서·멤버 CRUD 서버액션)
- [ ] CompanyForm.tsx (회사명/설명 수정)
- [ ] OrgTree.tsx (트리 렌더 + ↑↓ 버튼 + 부서 CRUD)
- [ ] DeptMemberPicker.tsx (사용자 검색·할당·제거)
- [ ] admin/org-chart/page.tsx (서버 컴포넌트)
- [ ] admin/layout.tsx 사이드바 추가

## Phase 2: 일반 사용자 뷰
- [ ] (member)/org/page.tsx (읽기전용 트리)

## Phase 3: 검증
- [ ] 브라우저 테스트 (어드민 CRUD)
- [ ] 브라우저 테스트 (/org 뷰)
- [ ] DC-REV 코드 리뷰
