# 02 작업 분해 — fix_plan.md 동기화

상세 체크리스트는 `.ralph/fix_plan.md` 가 SSOT. 본 문서는 의존성·순서 요약.

## 의존 순서
Phase 0(DOC+flag+views SSOT) → P1(통합 표 셸+보기) → P2(상세 패널) → P3(멀티모달 입력) → P4(RBAC) → P5(읽기 API+약점) → 검증 → 마무리

## 임계 경로
- P1-1 unified-views.ts(컬럼 SSOT) → P1-2 UnifiedTable → P2 DetailPanel
- P3-2 csv-intake.ts(보안) → P3-3 confidence-gate.ts → MultimodalIntake
- P5 읽기 API 4개는 P2 상세 패널의 "전체 견적/시세 이력/추출 이력" 실데이터 공급원

## 공수(기획 추정)
P1 ~5d · P2 ~4d · P3 ~5d · P4 ~3d · P5 ~5d · 검증 상시

## 루프 단위(증분)
각 루프 = fix_plan 미완료 1~소수 항목 + 파일 변경 + tsc 부분 확인. 진행 0이면 Circuit Breaker.
