# 00-summary — 홈 상단바 인사말 → 소속 조직 경로 (v0.7.179)

## 작업
홈 상단바(`headerLeft`)의 "안녕하세요, OOO님"이 본문 H1과 중복. 상단바를 **조직도 기준 소속 경로**(예: 데이터얼라이언스 › 전략마케팅본부)로 교체. H1 인사말은 유지.

## 수정 파일
- `lib/org-scope.ts` — `orgPathFromScope(scope, userId): string[]` 순수 헬퍼 신설 (nodes+closure 기반 조상 체인 산출, person/role 제외).
- `app/(member)/layout.tsx` — `resolveOrgScope` 호출 추가 → `orgPathFromScope`로 경로 산출 → `headerLeft`를 경로 브레드크럼으로 교체. 미소속 시 기존 인사말 폴백.

## 규칙
- 경로 = 회사 › 본부 › 팀… (조직도 전체 체인, person 노드 제외, role(직책) 제외).
- C레벨(`isExecutive`) = 회사(root)명만.
- 조직 미소속/노드없음 = 기존 "안녕하세요, OOO님" 폴백(중복은 남지만 정보없음 회피).
- 표시 변환 SSOT: 경로 산출은 org-scope.ts 1곳. 색·구분자는 토큰.

## 영향 범위
- 전 member 페이지 상단바(layout 공통). DB 변경 없음. 권한 로직 무변경(resolveOrgScope 재사용·읽기만).
- resolveOrgScope 1콜 추가(기존 Promise.all 병렬). org 데이터 소규모.

## 완료 조건
- [ ] 상단바에 소속 경로 표시(일반=회사›본부…, C레벨=회사만)
- [ ] H1 인사말 유지, 상단바 중복 제거
- [ ] 미소속 폴백 동작
- [ ] tsc 0 · design:check 통과 · 🟥 DC-REV PASS
