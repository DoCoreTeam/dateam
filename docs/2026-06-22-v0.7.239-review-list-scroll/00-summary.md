# FAST PATH Summary — v0.7.239

작업: 검토대기 스크롤을 "리스트만 스크롤"로 교정 — 스크롤 시 배너·필터/액션바(전체선택·일괄확정·일괄삭제)가 리스트와 함께 밀려 사라지던 문제 해결.

대상: ReviewTab.tsx, GpuPricingClient.tsx

원인(브라우저 실측): GPU 페이지는 fullpane(main overflow:hidden flex column) + 내부 스크롤 패널 구조가 이미 있었으나, 검토대기 래퍼가 `gpu-tab-panel--scroll`이라 ReviewTab **전체**(배너+필터/액션바+리스트)가 한 덩어리로 스크롤됨. gpu-topbar·gpu-tabs는 패널 밖이라 고정됐지만, 배너·필터/액션바는 패널 안이라 함께 밀림.

수정:
- GpuPricingClient: review 래퍼 `gpu-tab-panel--scroll` → `gpu-tab-panel`(overflow hidden, flex column).
- ReviewTab: 루트를 flex 칼럼(flex:1·minHeight:0)으로, 배너·필터/액션바는 flexShrink:0 고정, **리스트만 별도 div(flex:1·overflowY:auto)로 스크롤**.

검증(브라우저 실측, is_test 6건 오버플로): 리스트 400px 스크롤 시 탭(137)·배너(200)·필터/액션바(278) top 불변(고정), 첫 카드만 -64로 이동. 전체선택 후 스크롤해도 일괄 확정 버튼 계속 노출. tsc 0 / lint 0 / test 480 / build ✅(163/163) / design ✅. 다른 GPU 탭 영향 없음(review 래퍼만 변경).
