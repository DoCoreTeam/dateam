# 회의노트 AI UX 일원화 — v0.7.257

## 작업
회의노트 상세의 별도 "AI 분석" 카드를 해체하고 본문 카드 하나로 통합 (일일업무식 "저장→정제" 단일 흐름).

## 수정 파일
- `app/(member)/meeting-notes/MeetingAiPanel.tsx` — 본문 카드로 확대: 헤더에 [정제본|원본] 탭 + AI 분석 버튼, 정제본 탭=요약/결정사항 편집면(SSOT), 원본 탭=RichText, 추출 후보를 카드 하단 통합, 단일 confirm. `body` prop·BodyTab·tab state 추가
- `app/(member)/meeting-notes/MeetingDetailClient.tsx` — BodySection/BodyTab 제거, MeetingAiPanel을 단일 본문 카드로 렌더(body 전달), RichText/useEffect import 정리

## 변경 이유
- **혼란 원인**: 요약·결정사항이 본문 정제본 탭(읽기)과 AI 패널 textarea(편집) **두 군데 중복 렌더** + 각자 state라 동기화 단절. 카드가 3개(본문/참석자/AI)로 세로로 늘어짐.
- **해결**: summary/decisions를 MeetingAiPanel 단일 state로 SSOT화. 정제본 탭이 곧 편집면. AI 분석은 헤더 버튼. 추출 후보는 같은 카드 하단. → 카드 3→2개, 늘어짐·분절 해소.

## 영향 범위
- meeting-notes FE 2개 컴포넌트. DB·서버액션(applyExtractedItems/saveMeetingSummary/updateMeetingNote) 무변경 → 회귀 0.
- 흐름: 저장(본문 dirty)→자동분석→정제본 탭 기본 노출→추출 후보 체크리스트 확정(§5-3 유지).

## 검증 (브라우저 E2E, throwaway 계정)
- 데스크탑(1440)·모바일(375): 본문 카드 1개에 탭+버튼+편집+저장 통합, 참석자 카드 1개 = 총 2카드
- "AI 분석" 버튼 → 추출 후보(참석자/업무/일정/하이라이트)가 같은 카드 하단에 렌더
- 정제본 탭 기본 선택, 요약/결정사항 편집 가능
- 🟥 DC-REV APPROVED (state 일원화·탭 전환·confirm 회귀 0)

## 설계 결정 (사용자 확정)
- AI 분석 트리거: 저장 시 자동 + 헤더 버튼
- 추출 반영: 체크리스트 확정 유지(자동반영 아님)
