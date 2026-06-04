# 테스트 전략
## 단위(pricing.test.ts, node:test) 10/10
- gcube list 제외, 채택 override, 만료 폴백, list 패스스루(마진 미적용).
## UI(Playwright)
- 가격표 펼침: gcube 참고선·기준선택 버튼 노출.
- 기준 선택 → 리스트 금액 반영(₩4,452 Voltage).
- 고객가격표 동일 반영 + 커버리지 유지(Tier1/2/3).
- 시장비교 정상.
