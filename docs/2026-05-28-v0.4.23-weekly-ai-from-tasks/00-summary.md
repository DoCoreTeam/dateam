# 주간보고 AI 자동생성 — 일일업무 → 주간보고

## 작업 요약
주간보고 작성 폼에 해당 주의 일일업무 리스트를 보여주고, 사용자가 선택한 업무를 기반으로
AI(Gemini)가 주간보고 스타일 가이드 MD를 읽어 {구분/성과/계획/이슈} 형식으로 자동 생성.

## 수정 파일
- `apps/web/docs/weekly-report-ai-style.md` (신규)
- `apps/web/lib/gemini-daily-to-weekly.ts` (신규)
- `apps/web/app/api/weekly-report/generate-from-tasks/route.ts` (신규)
- `apps/web/app/(member)/weekly-report/DailyTaskSelector.tsx` (신규)
- `apps/web/app/(member)/weekly-report/WeeklyReportForm.tsx` (수정)

## 변경 이유
기존에는 주간보고를 수작업으로 작성해야 했음.
일일업무 데이터가 이미 DB에 있으므로 AI로 변환하면 보고 작성 시간 대폭 단축 가능.

## 영향 범위
- 주간보고 폼 UI에 일일업무 선택 패널 추가
- 기존 "AI로 다듬기" 기능과 별개로 동작 (충돌 없음)
- 새 API 엔드포인트 추가 (기존 API 변경 없음)

## 핵심 설계 결정
1. 스타일 가이드는 `apps/web/docs/weekly-report-ai-style.md` 파일에서 런타임 `fs.readFileSync`로 읽음 (하드코딩 금지)
2. AI API: Gemini (기존 org_content.META.gemini_api_key 패턴 동일)
3. UI: 폼 상단 접을 수 있는 패널 형태로 일일업무 표시
