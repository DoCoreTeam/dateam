# Fix Plan — 루틴 빈도 재설계 + 주간보고 모달 에디터
생성: 2026-05-21

## Phase 0: 설계 결정
- [x] DECISION: weekly 기본값, string 포맷 하위호환
- [x] DECISION: weekly 체크 → check_date = week_start

## Phase 1: 루틴 빈도 재설계
- [x] page.tsx — RoutineItem 타입 파싱, freq 지원
- [x] RoutineGrid.tsx — weekly/daily 분리 렌더링
- [x] admin/routine/page.tsx — weekly 집계 수정 (1/1 not 7)

## Phase 2: 주간보고 모달 에디터
- [x] EditorModal.tsx 신규 생성
- [x] WeeklyReportForm.tsx — 인라인 에디터 → 클릭-투-오픈 모달

## Phase 3: 검증
- [x] tsc --noEmit 통과
- [x] git commit
