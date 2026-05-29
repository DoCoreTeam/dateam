# FAST PATH Summary
작업: GPU 통합 입력 AI 추출 결과 패널 UX 개선 — 분석 중 스피너 + null/object 표시 수정
대상: apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx, apps/web/app/globals.css
이유: 분석 중 상태가 빈 상태와 시각적으로 구분 안됨 / null 값이 "null" 문자열로 표시됨 / quantity 등 객체 값이 [object Object]로 표시됨 / 공급사 null 시 경고 없음
영향: 없음 (표시 로직만 변경, API/DB 무관)

## 변경 사항
1. **globals.css**: gpu-spin, gpu-pulse 애니메이션 + .gpu-analyzing-icon / .gpu-analyzing-text CSS 클래스 추가
2. **QuoteRegisterTab.tsx**:
   - analyzing 상태: 회전 스피너 아이콘 + 펄스 텍스트로 교체 (빈 상태와 명확히 구분)
   - null 값: "null" 문자열 → "—" (이탤릭, 투명도 55%)
   - 객체 값: [object Object] → JSON.stringify() 출력
   - 공급사 null: 노란색 "⚠ 공급사 미확인" 배지 표시
