# Test Strategy

## Playwright E2E
- 시나리오: H100 + A100 혼합 텍스트 입력 (mock AI 없이 실제 AI 호출)
- 검증: 탭 2개 렌더, DB 2건 저장
- 대안: AI 키 미설정 시 → 에러 메시지 표시 확인

## 단위 검증
- TypeScript typecheck 통과
- 기존 단일 모델 시나리오 regression 없음
