# 02 작업 분해

## T1 actions.ts — addRawDailyLog
- 시그니처: `addRawDailyLog(text, logDate, originGroupId, isOnboarding=false): Promise<{ok,data}|{ok:false,error}>`
- 1행 INSERT: content=text.trim(), entry_type='doing', source_type='manual', ai_processed=false,
  original_input=text, origin_group_id=originGroupId, is_onboarding.
- 반환 행을 클라이언트가 낙관적 임시행 교체에 사용.

## T2 page.tsx — handleSave 재작성
- 기존 handleAiSave 본문 교체. 낙관적 mutate → addRawDailyLog → 백그라운드 분해.
- 백그라운드 함수 runBackgroundAnalyze(text, G, date, onboarding):
  - fetch analyze-work, 스트림 수집(collected), item.originGroupId=G, item.originalInput=text
  - addMultipleDailyLogs(collected, date, undefined, onboarding) → mutate → autoRegisterSchedules → mutate(cal)
  - finally: analyzingGroupIds에서 G 제거
- 실패/0건: aiError 대신 그룹 단위 실패 상태(원문 보존, 토스트 무해).

## T3 page.tsx — analyzingGroupIds 상태
- DailyPage(또는 리스트 소유 컴포넌트)에 `Set<string>` 상태.
- 리스트 컴포넌트 → OriginGroupCard로 `isAnalyzing` 전달.

## T4 OriginGroupCard.tsx — raw 헤드/자식 분리 + 분석중 칩
- rawHead = group.logs.find(!ai_processed); childCards = group.logs.filter(ai_processed)
- 헤더 텍스트 = rawHead?.original_input ?? rawHead?.content ?? label
- 드로어: childCards 렌더(없으면 isAnalyzing? "분석 중" : "분석 결과 없음·재분석")
- 요약 칩 카운트(분해 N/메모/완료)는 childCards 기준.

## T5 grouping.ts — 헬퍼(필요 시)
- 표시 카운트가 raw 헤드를 제외하도록 OriginGroupCard 내부에서 처리(grouping.ts 최소 변경 지향).

## T6 테스트
- grouping/표시 단위 테스트(raw 헤드 분리, childCount).
- Playwright e2e: 즉시표시·<300ms·원문보존·백그라운드 분해 등장.
