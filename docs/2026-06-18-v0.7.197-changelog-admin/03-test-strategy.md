# 03 — Test Strategy
## 단위(node:test)
parse-commits: `vX.Y.Z: 내용 claude` 파싱, claude/Co-Authored 제거, 동일버전 묶기, type 태깅, merge/revert 스킵, 형식밖 스킵.
## 정적
tsc / design:check / next build.
## 직접 E2E(Playwright, throwaway admin, is_test)
1) 버전 버튼 클릭 → ChangelogModal 보임 + 게시 항목 렌더
2) admin/changelog 접근 → 가져오기 → 목록 채워짐 → 행 게시토글 → 공개 모달 반영
3) 추가/수정/삭제 1건 + 검색/필터 동작
테스트 데이터는 is_test 또는 명확 식별 version(예: 0.0.0-e2e)로 후 정리.
## RLS 검증
멤버 토큰으로 미게시 행 조회 안 됨(게시분만).
