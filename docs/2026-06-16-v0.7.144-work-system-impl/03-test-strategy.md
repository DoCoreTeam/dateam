# 03 테스트 전략
단위: useDraft(저장·복원·clear·TTL·exclude), useUndoable(undo/redo/maxHistory 결정성), group 집계 순수함수.
E2E(Playwright,실세션 magiclink): ①일일에 부서업무 안 보임(역류제거) ②일일→부서 승격 후 부서화면 노출·일일 유지 ③그룹뷰 축토글·집계 ④대시보드 위젯 렌더 ⑤입력 후 새로고침→임시저장 복원배너→복원 ⑥Ctrl+Z 되돌리기. 실데이터/계정, is_test 격리·revert.
회귀: 부서업무 화면·주간보고 인용 정상.
