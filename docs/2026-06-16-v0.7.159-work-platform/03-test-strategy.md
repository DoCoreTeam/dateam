# 03 테스트 전략

- 공통: `tsc --noEmit` 0, `design:check` 통과, 각 Phase DC-QA/SEC/REV.
- ④검색: 빈 q 처리, 한글 부분일치, type별 결과·권한(타인 일일 미노출/조직 부서업무 가시), 주간보고 HTML→plain 매칭, 페이지네이션, 빈/에러 UI. 단위: 결과 정규화/스코프 필터 순수함수.
- ②릴레이션: 승격된 일일에 뱃지 표시·미승격엔 없음, 부서업무 상세 원본/작성자/담당자 표시, 권한(본인/조직). 새로고침 유지.
- ③그룹핑: project 축 그룹 집계 정확, autolink 프로젝트 매칭, RLS, 빈 프로젝트 처리.
- 보안(DC-SEC): search org-scope·RLS, project RLS, IDOR, 임베딩/검색 입력 검증.
- 회귀: 기존 일일/부서/주간/현황/autolink 무회귀.
