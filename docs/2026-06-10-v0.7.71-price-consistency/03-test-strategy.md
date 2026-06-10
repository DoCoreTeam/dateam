# 03 Test Strategy
## 단위
- derive-configs/사다리: 모델별 누락단 보충 정확, 멱등(재실행 무변).
- cockpit 전파원가: 실제견적 없을때 effective 기반 cost+is_propagated, 있을때 기존.
- buildCatalog 회귀: effective/sell 불변(기존 테스트 유지).
## 통합
- 마이그082 후 전 모델 {1,2,4,8} 보유, A100 x8 1건.
- cockpit API: x8 원가가 전파값으로 채워지고 is_propagated=true.
## E2E(Playwright, 실증)
- 콕핏 A100 x8 원가 "—"→전파 추정값 표시 + 배지.
- 가격표 A100 x8(_derived) 행 펼침 → "1장당 전파 $1.95×8 추정" 표시.
- 전 모델 검색 시 x1/2/4/8 노출.
- 판매가후보 [지정]→우리판매가 설정 반영.
## 게이트
tsc0 / design:check / npm test / 브라우저 콘솔 0.
## 격리
운영 데이터 백필은 실제(의도된 정합화). 테스트 전략가 지정은 검증 후 원복.
