# FAST PATH Summary

작업: 부서업무 AI 추출 패널 레이블 "AI로 부서업무 후보 찾기" → "부서업무 탐색"으로 변경
대상: `apps/web/app/(member)/dept-tasks/DeptTaskSuggestPanel.tsx` (토글 :91, 실행버튼·로딩 :115)
이유: "AI로 부서업무 후보 찾기"가 사용자에게 모호 → 직관적 명칭 "부서업무 탐색"으로 통일
영향: 문구만 변경, 기능/로직/DB 변경 없음. 연관 실행 버튼도 "✨ 탐색 시작 / 탐색 중…"으로 일관화
