# FAST PATH Summary
작업: USD 3자리 콤마 포맷 수정 + 공급사 미지정 견적 UI 표시 개선
대상: PriceTableTab.tsx, catalog/page.tsx, MarketTab.tsx
이유: toFixed()는 콤마 없음 → toLocaleString('en-US') 사용. supplier_id NULL 견적에 "—" 대신 "공급사 미지정" 앰버 표시
영향: 모든 탭의 USD 금액 가독성 개선, 데이터 무결성 경고 UX 추가
