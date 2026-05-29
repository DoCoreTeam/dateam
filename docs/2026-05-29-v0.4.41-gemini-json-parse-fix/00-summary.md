# FAST PATH Summary
작업: 주간보고 AI 정비/생성 기능의 JSON 파싱 에러 수정
대상: apps/web/lib/gemini-refine.ts, apps/web/lib/gemini-daily-to-weekly.ts
이유: Gemini가 JSON 뒤에 추가 텍스트 반환 시 try/catch 없는 JSON.parse()가 raw V8 SyntaxError를 UI까지 전달
영향: apps/web/app/api/weekly-report/refine/route.ts (gemini-refine.ts 사용 — 수정 없음)

## 변경 사항
1. **gemini-refine.ts**: parseGeminiJson() 헬퍼 추가
   - 마크다운 코드 펜스(```json) 제거 후 재시도
   - try/catch로 raw V8 에러 대신 사용자 친화적 메시지 반환
   - refineWeeklyReport() (211줄), refineReports() (288줄) 두 곳에 적용
2. **gemini-daily-to-weekly.ts**: 동일한 parseGeminiJson 패턴 적용
   - 기존 try/catch 있었으나 코드 펜스 처리 없음 → 강화

## 에러 재현 조건
- Gemini가 `[{...}]` 뒤에 설명 텍스트 또는 마크다운 코드 펜스로 감싸서 반환할 때
- JSON.parse("valid-json\nsome extra text") → SyntaxError: Unexpected non-whitespace character after JSON at position 1391
