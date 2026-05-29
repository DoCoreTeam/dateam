# FAST PATH Summary
작업: 분석 중 단계별 메시지 UX + temperature 0 고정 (결과 불일치 버그 수정)
대상:
  - apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx
  - apps/web/app/api/pricing/gpu/review/route.ts
  - apps/web/e2e/gpu-quote-analyze-steps.spec.ts (신규)
  - playwright.config.ts (신규)
이유:
  1. temperature:0.1이어서 동일 입력으로도 매번 다른 결과 출력 → 0으로 고정
  2. 분석 중 상태가 고정 메시지 1줄뿐 → 5단계 단계별 메시지 + 진행 도트 추가
영향: API 동작 변경(temperature) + UI 애니메이션 추가

## 변경 사항
1. route.ts: temperature 0.1 → 0 (결정적 응답 보장)
2. QuoteRegisterTab.tsx:
   - useEffect import 추가
   - analyzeStep state 추가
   - ANALYZE_STEPS 상수 5단계 정의 (2.5초 간격으로 자동 전환)
   - 분석 중 패널: 단계별 메시지 + 부제목 + 진행 도트 인디케이터
3. e2e/gpu-quote-analyze-steps.spec.ts: Playwright 스모크 테스트 3개 (PASS)
