# 00-summary — 미처리 메모를 주간보고 작성 흐름에 유기적 통합 (안 A)

작업: 주간보고 상단의 **경고색 "미처리 메모" nudge 카드(WeeklyMemoReview)를 제거**하고, 미처리 메모를 **우측 인테이크 패널(MemoIntakeList)** 후보로 통합 — 체크 → "폼에 반영"(AI가 주간행 생성 후 병합) → 해당 메모 `reviewed` 처리로 자연 소진. 나무라는 상시 경고 대신 작성 흐름에 녹임.

## 사용자 결정
- 방향 **A. 작성 흐름에 녹이기**(AskUserQuestion 확정). B(조용히)·C(자동감쇠)·D(주간보고서 제외)는 미채택.

## 대상 파일
- `apps/web/lib/weekly-report/generate-client.ts` (신규 32줄) — `generateWeeklyRows(tasks)` = `/api/weekly-report/generate-from-tasks` 호출 SSOT. 일일업무·메모 양쪽 재사용(복붙 제거).
- `apps/web/app/(member)/weekly-report/MemoIntakeList.tsx` (신규 153줄) — 미처리 메모(`/api/daily/memos?status=unreviewed`) 체크리스트. "폼에 반영"=선택 메모를 note 태스크로 generateWeeklyRows→`onReflect`(mergeWeeklyRows)+`setMemoStatus reviewed` 소진. 개별 "확인"(반영 없이 reviewed) 이스케이프.
- `apps/web/app/(member)/weekly-report/DailyTaskSelector.tsx` — handleGenerate를 generate-client SSOT로 리팩터(중복 fetch 제거, 268→253줄).
- `apps/web/app/(member)/weekly-report/WeeklyReportForm.tsx` — 우측 aside에 `MemoIntakeList` 추가(DailyTaskSelector 아래), onReflect→mergeWeeklyRows.
- `apps/web/app/(member)/weekly-report/page.tsx` — `WeeklyMemoReview` import/렌더 제거.
- `apps/web/components/ui/memo/WeeklyMemoReview.tsx` — **삭제**(이 변경으로 유일 사용처 사라져 고아화 → 규칙상 내 변경이 만든 미사용만 제거).

## 이유
미처리 메모가 4곳(주간보고·홈·일일)에 상시 노출되고 4일+ 경과 시 빨간 pulse로 나무라 "거슬림". 주간보고에선 방금 만든 우측 매핑 패널에 메모를 후보로 합류시키면, 반영=리뷰가 되어 별도 경고 없이 자연 소진.

## 영향
- 홈(`UnreviewedMemoWidget compact`)·일일(`UnreviewedMemoWidget full`, `MemoListView`) 메모 위젯은 **무변경**(주간보고 상단 카드만 제거).
- DB/RLS/마이그레이션 없음. 메모 소진은 기존 `setMemoStatus` 재사용.
- generate-from-tasks에 note 태스크가 흘러가나 기존 엔드포인트가 entry_type 유연 처리(기본 done, note 허용).

## 완료조건
- [x] 주간보고 상단 경고 메모카드 제거
- [x] 우측 패널에 미처리 메모 후보 표시(체크→폼 반영)
- [x] 반영 시 메모 reviewed 소진 + 목록 제거
- [x] generateWeeklyRows SSOT로 일일업무/메모 공유(복붙 0)
- [x] 전 파일 300줄 이하, tsc·design·749테스트 PASS
- [ ] 로그인 실화면 확인(사용자) — 우측 메모 후보·반영·소진 동작
