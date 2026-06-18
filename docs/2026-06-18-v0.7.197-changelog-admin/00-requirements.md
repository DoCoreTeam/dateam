# 00 — Requirements (v0.7.197 체인지로그 + 어드민)
## 문제
버전이 정적 span(클릭 불가), 업데이트 내역을 사용자가 볼 곳 없음. 어드민 관리 필요.
## 요구
- R1 사이드바 버전 클릭 → 게시된 버전별 변경내역 모달
- R2 admin/changelog: CRUD + 게시토글 + git 커밋 자동 가져오기(하이브리드)
- R3 DB app_releases(RLS: admin 쓰기/게시분 멤버 읽기) SSOT
- R4 검색·정렬·필터·서버 페이지네이션·URL 동기화·로딩/빈/에러 3종
- R5 직접 Playwright(throwaway, is_test) 검증
## 비범위
- 새 버전 읽음 빨간점, i18n 변경문, MINOR 섹션 그룹 헤더(후속)
## 완료정의
PROMPT 완료기준 1-8 전부.
