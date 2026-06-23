# 회의노트 CRUD 모드 분리 — v0.7.258

## 작업
조회=읽기전용 / 수정=에디터 통합 / 삭제=조회 노출로 CRUD 모드 분리.

## 변경
- actions.ts: updateMeetingNote가 summary/decisions 필드 수용(에디터에서 수정 저장)
- AttendeesEditor.tsx(신규): 컨트롤드 참석자 편집(에디터 내장, 자체 저장 없음)
- ExtractConfirmModal.tsx(신규): AI 추출 후보 확정을 모달로(조회 인라인 제거)
- MeetingReadBody.tsx(신규): 조회 본문 카드 = [정제본|원본] 읽기 탭 + AI 분석 버튼(→모달)
- MeetingEditor.tsx: 제목·일시·부서·본문 + 요약·결정사항·참석자·태그 전부 편집
- MeetingDetailClient.tsx: 조회=읽기(헤더 [목록][편집][삭제] + ReadBody + 참석자 chips), 수정=에디터
- 제거: MeetingAiPanel.tsx, AttendeesPanel.tsx (조회 인라인 편집 → 폐기)

## 모드별 책임
- CREATE(/new): 에디터 — 제목·일시·부서·본문(+참석자·태그)
- READ(/[id]): 읽기전용 — 정제본/원본 탭(읽기), 참석자 chips, [AI 분석] 액션(→모달), [삭제]
- UPDATE(편집): 에디터 — 모든 필드(요약·결정·참석자·태그 포함)
- DELETE: 조회 헤더 + 에디터 둘 다

## 이유
조회 화면에 요약/결정 textarea·참석자 add/remove/저장이 박혀 "수정폼"으로 보이던 문제 해소.
수정 동선이 조회 인라인과 편집화면으로 갈라지던 모순 제거 → 모든 수정은 에디터 한 곳.

## 설계 결정(사용자 확정)
- AI 분석·추출후보 = 조회 화면 액션 유지(요약 읽기표시 + 후보 모달)
- 에디터 범위 = 제목·일시·부서·본문 + 요약·결정·참석자·태그 전부

## 영향
- DB 스키마 무변경(기존 컬럼 재사용). updateMeetingNote 필드 확장만(하위호환).
