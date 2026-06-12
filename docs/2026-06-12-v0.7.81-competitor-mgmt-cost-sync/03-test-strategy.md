# 03 테스트 전략 (v0.7.81)
단위/타입: tsc0, design:check, test(기존+).
API(throwaway·원복): competitors GET/POST/PATCH/DELETE/bulk-delete/bulk-promote 200·권한·소프트삭제·멱등. 동기화: 값변경→pending 생성, 동일값→0. 승인: pending→confirmed+supersede. 실견적 우선: market_link 제외 확인.
Playwright E2E(필수, 원복): 경쟁사 탭에서 등록→수정→다중선택 일괄삭제 / 다중선택 일괄 공급사지정→공급사 탭 등장 / "가격 동기화"→검토대기 배지 증가→승인 / 실견적 있는 모델은 추종가 미사용 배지. 콘솔0. 테스트데이터 전량 원복.
보안: 공개 API supplier_id·연계 비노출. admin 게이트.
