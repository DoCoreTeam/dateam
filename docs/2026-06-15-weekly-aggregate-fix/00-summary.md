# 주간보고 취합 4대 결함 보수 — 작업 요약

작성 2026-06-15 · v0.7.111 · MEDIUM-LARGE · 도메인=주간보고 취합

## 배경 (🟦 DC-ANA×3 분석)
취합(`aggregateDept`)이 **이번주 데이터만 받아 매번 새로 생성→통째 교체**. 지난주(구분·계획)도 기존 편집본도 참조 안 함 → ①결과 날아감 ②구분 매주 달라짐 ③계획→성과 미이행·임의삭제.

## 작업 (A/A: 병합 우선·무손실)
| # | 결함 | 보수 |
|---|------|------|
| ① | 지난주 구분 기준 미사용 | prevWeek dept 보고 category → 병합 프롬프트에 "같은 의미 구분은 이 명칭으로 통일" 주입 |
| ② | 계획→성과 미이행 | prevWeek dept 보고 plan → "이행된 계획은 이번주 성과에 반영" 주입 |
| ③ | 전면 교체·임의 삭제 | 기존 current body(편집본) → "새 취합을 기존과 주제 기준 병합, 기존 편집 임의 삭제 금지·보강" 주입 |
| ④ | 편집·확정 소실 | upsert 시 기존 status 보존(confirmed면 유지, draft 강제 금지) |
| ②' | 개별보고 구분 드리프트 | generate-from-tasks·refine 경로에도 지난주 구분 주입 |

## 수정 파일
- `lib/gemini-refine.ts` — mergeAndRefineByCategory(opts) + 프롬프트 컨텍스트, refineWeeklyReport(prevCategories)
- `app/(member)/weekly-report/org-actions.ts` — aggregateDept: prevWeek+기존편집 조회, status 보존 upsert
- `app/api/weekly-report/refine/route.ts` — prevCategories를 refineWeeklyReport에 전달
- `app/api/weekly-report/generate-from-tasks/route.ts` + `lib/gemini-daily-to-weekly.ts` — prevWeekCategories 주입

## 동작 (재취합 = 병합·보존)
재취합 시: 지난주 구분으로 정렬·통일 + 지난주 계획 성과 이행 + 기존 편집본과 주제 병합(편집 보존) + status 보존. → 더 이상 "날아감"·"임의 삭제" 없음.

## 영향
- 기존 편집/확정 데이터 무손실(보수 핵심). DB 스키마 변경 없음(기존 컬럼만). 계산 도메인 무관.

## 완료조건
- [ ] 4결함 닫힘 + 개별경로 ② + Playwright 무손실 검증
- [ ] tsc0/test/design/lint + 🟥 DC-QA/SEC/REV
