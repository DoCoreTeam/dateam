# 일일업무 즉시 저장 + AI 자동 셋팅 (확인 패널/버튼 제거)

## 결정(오너)
- 저장 즉시 AI가 **전부 자동 셋팅**(분해+일정+메모). 우측 AiResultPanel(후보 확인) 제거.
- 일정은 **캘린더 자동 등록**(확인 버튼 없음). "캘린더에 추가?" 물어보면 안 눌러서 효용 낮음(오너 피드백).
- 오등록 안전장치 = 사전 확인이 아니라 **사후 원클릭 취소/삭제 즉시 반영**.

## 변경 설계
1. 저장 플로우: handleAiSave가 analyze-work 스트림 완료 후 **자동으로 addMultipleDailyLogs 커밋**(handleAiConfirm 자동화). 패널 미오픈, 입력창에 인라인 "분석 중" 표시 → 완료 시 목록 자동 갱신.
2. 일정 자동 등록: 저장된 분해 항목 중 target_date/scheduled_at 보유 항목을 **자동으로 calendar_events INSERT**(기존 createDailyScheduleEvent 재사용, 중복가드). 사용자 클릭 불필요.
3. ScheduleSection 변경: "후보 체크 → 추가 버튼" → "캘린더 등록됨 ✓ [취소]" 표시(자동등록 상태 + 원클릭 취소=linked event 삭제).
4. 삭제 cascade: deleteDailyLog가 연결된 calendar_events(link_kind='daily', link_id) 도 함께 삭제 → 드로어에서 항목 삭제 시 캘린더에서도 즉시 사라짐.
5. 드로어 수정/삭제는 기존 renderCard 액션 그대로(즉시 반영).

## 비고
- 이전 P2 "확인형"을 오너 결정으로 "자동형"으로 전환. 원본 비파괴는 유지(원본은 original_input 보존).
- AI=후보 표준(5-3) 대비 자동 커밋이지만, 오너 명시 결정 + 즉시 취소로 완화.

## 영향/위험
- 잘못 분해/오등록이 즉시 반영됨 → 드로어 삭제로 정리(취소 1클릭). 신규 테이블/마이그레이션 없음(기존 calendar_events/daily_logs 재사용).
- 회귀 주의: 저장 핸들러·삭제 핸들러·ScheduleSection.

## 완료조건
- 저장→인라인 분석중→자동 분해/메모/캘린더 반영, 패널·확인버튼 없음.
- 드로어 삭제 시 calendar_events도 삭제. tsc0·design·test·실인증 재현·DC-QA/SEC/REV.
