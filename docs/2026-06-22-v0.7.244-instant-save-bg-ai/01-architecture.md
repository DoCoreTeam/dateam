# 01 아키텍처

## 데이터 모델 (변경 없음 — 기존 컬럼 재사용)
`daily_logs`:
- `origin_group_id` — 같은 입력 묶음 식별 (그룹핑 기준, grouping.ts)
- `source_type` — 'manual' | 'ai_split' | 'ai_derived' | 'thread_derived'
- `ai_processed` — boolean (원문 raw 행=false, AI 분해 자식=true)
- `original_input` — 원문 텍스트(OriginGroupCard 헤더 소스)

### 그룹 구성 (신)
하나의 입력 → 같은 `origin_group_id = G`:
- **원문 raw 헤드 행 1개**: content=원문, source_type='manual', ai_processed=false, original_input=원문
- **AI 분해 자식 N개**: source_type='ai_split', ai_processed=true, original_input=원문 (기존 동작)

기존 그룹핑(`groupDailyLogs`, origin_group_id 기준)은 그대로 두 행을 한 그룹으로 묶는다.

## 렌더 경로 (실제, SSOT)
`page.tsx` groups.map → `OriginGroupCard`:
- 헤더 = raw 헤드(ai_processed=false)의 original_input
- 드로어 자식 카드 = `group.logs.filter(ai_processed)` (raw 헤드는 카드로 중복 렌더 안 함)
- 자식 0개 + 분석중 → "AI가 분석 중…" 칩
- 자식 0개 + 분석끝(실패) → "분석 결과 없음 · 재분석" 안내

## 제어 흐름 (신 handleSave)
1. click → `originGroupId = crypto.randomUUID()`
2. **낙관적 mutate**: 임시 raw DailyLog를 SWR 캐시에 즉시 삽입 → 입력칸 비움 (UI 0ms)
3. `addRawDailyLog(text, date, G, onboarding)` 서버 INSERT → revalidate(실 id로 교체)
4. **백그라운드(await 안 함)**: `/api/ai/analyze-work` 스트림 수집 → `addMultipleDailyLogs(items[ originGroupId=G ])` → revalidate → autoRegisterSchedules
5. analyzingGroupIds에 G 추가/제거로 분석중·실패 UX 제어

## SSOT 재사용
- AI 호출: 기존 `/api/ai/analyze-work` 그대로.
- 분해 저장: 기존 `addMultipleDailyLogs` 그대로(items[].originGroupId=G 주입).
- 신규 코드는 raw 헤드 INSERT(`addRawDailyLog`)와 흐름 재배선뿐.
