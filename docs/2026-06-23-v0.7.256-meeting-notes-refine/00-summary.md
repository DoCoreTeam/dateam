# 회의노트 4이슈 개선 — v0.7.256

## 작업
회의노트 기능의 레이아웃·AI 트리거·본문 표시·연계 4개 영역 개선.

## 수정 파일
- `app/(member)/meeting-notes/page.tsx` — 리스트 테이블 colgroup + fixed layout + 일시 nowrap
- `app/(member)/meeting-notes/MeetingDetailClient.tsx` — 본문 [정제본|원본] 탭, 정제본 기본/원본 폴백
- `app/(member)/meeting-notes/MeetingEditor.tsx` — 저장 후 `?analyze=1`로 상세 이동
- `app/(member)/meeting-notes/MeetingAiPanel.tsx` — autoAnalyze(저장 직후 1회 자동분석) + summary/decisions 자동저장, 기본 분석버튼 제거

## 변경 이유 (이슈별)
1. **레이아웃**: `.table-base`가 `table-layout:auto`라 요약 컬럼이 폭을 독식 → 제목·일시·상태 줄바꿈. 전역 CSS는 다른 테이블에 영향 가므로 meeting-notes 테이블에 한해 colgroup+fixed로 컬럼폭 고정.
2. **자동분석(C안)**: 저장과 분리된 "AI 분석" 버튼 클릭 방식 → 저장 직후 자동 분석. 비용통제 위해 "저장 시점"에만 트리거(`?analyze=1`). 추출 할일/일정은 §5-3 추출형 표준대로 후보 체크리스트 확정 유지.
3. **정제본 기본표시**: 정제본(summary)/원본(body_html)은 이미 분리 저장됨. 상세 본문이 원본만 보여줬음 → 탭으로 정제본 기본 노출, 분석 전(summary 없음)이면 원본 폴백.
4. **연계**: `applyExtractedItems`가 daily_logs INSERT + createCalendarEvent로 이미 완전 구현. 코드 변경 없음 — 이슈2 자동화로 추출 시작이 자동화되며 체감 개선.

## 영향 범위
- meeting-notes 4개 컴포넌트. 전역 CSS·다른 화면 무영향.
- DB 스키마 변경 없음(기존 summary/decisions/body_html 재사용).
- AI 호출: 저장당 1회(C안 — 사용자 비용 동의 완료).

## 설계 결정 (사용자 확정)
- 이슈2: **C안** (저장→자동분석+후보확정). D안(완전자동) 반려.
- 이슈3: **탭 전환** (정제본 기본 / 원본 폴백).
