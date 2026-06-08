# 업무 허브 + AI 추출 — 아키텍처 설계서 (기획)

> 2026-06-08 · 구현 0. 모든 코드/스키마는 설계 예시(미적용). 근거: 🟦 DC-ANA·DC-RES.

## 0. 재사용 맵 (🟦 DC-ANA — 코드 근거)
| 요구 | 기존 자산 | 재사용 방식 |
|------|-----------|------------|
| 부서원 ID 조회 | `lib/org-scope.ts` `resolveOrgScope`·`deptMemberUserIds` | 그대로 호출(부서장=서브트리, 본인=self) |
| 로그→AI 변환 엔진 | `lib/gemini-daily-to-weekly.ts` `generateWeeklyFromDailyTasks(tasks,styleGuide,key,model,uid)` | styleGuide만 "부서업무 추출용"으로 교체 |
| 스트리밍 추출 API 패턴 | `api/ai/analyze-work/route.ts` (SSE+NDJSON) | 구조 복사 |
| 프롬프트 관리 | `ai_prompts` 테이블(prompt_key) | 새 key 1행 추가 |
| JSON 파싱 | `lib/gemini-refine.ts` `parseGeminiJson` | import |
| 비용 추적 | `lib/token-logger.ts` `logTokenUsage` | 호출 |
| 선택기 UI | `weekly-report/DailyTaskSelector.tsx`(fetch→체크→AI) | 70% 재사용 |
| 부서업무 등록 | `dept-tasks/actions.ts` `createDeptTask` + util(`lib/dept-task-utils.ts`) | bulk 래퍼 추가 |
| 탭 패턴 | `weekly-report/page.tsx` `tabStyle()`+Link | WorkTabBar로 추출 |
| API키 | `org_content` META(`gemini_api_key`/`gemini_model`) | 동일 패턴 |

## 1. ① AI 업무 추출 — 설계

### 1.1 데이터 소스 (org-scope)
- 대상 user_ids: 부서장 → `deptMemberUserIds(scope, deptId)`, 일반 → `[self]`.
- 기간: 기본 최근 2주(최대 4주). 상태 필터 `entry_type IN ('doing','planned','blocker')`(done 제외 → 토큰 30~50%↓).
- 입력 = daily_logs.content(+log_date, user) + 해당 기간 weekly_reports(category/performance/plan/issues). admin client로 부서원 접근(weekly-report/org-actions 패턴).

### 1.2 신규 API `app/api/ai/suggest-dept-tasks/route.ts` (설계 예시)
- 입력: `{ scope: 'dept'|'mine', departmentId?, weeks?:1..4 }`
- 처리: 권한 확인(부서장만 dept) → 로그/주간 fetch → 기존 dept_task 제목 CSV 주입 → Gemini 일괄(`responseMimeType:'application/json'`, temp 0.0) → 후보 배열 반환.
- 출력 후보 스키마(DC-RES 권장):
```
ExtractedCandidate { title, assignee_hint|null, priority, due_hint|null,
  source_log_date, source_quote|null, confidence, existing_match|null }
```
- 가드: `source_quote=null` 또는 `confidence<0.7` → 서버에서 제외. 기간/건수 캡. `logTokenUsage` 기록.
- 4주↑ 요청: 원본 로그 대신 weekly_reports 요약 사용(토큰 80%↓).

### 1.3 프롬프트 (`ai_prompts` 신규 key `dept-task.suggest`)
"로그에서 실행가능한 *부서 공유 업무*만 추출. 각 항목에 원문 source_quote 강제(없으면 제외). 기존 부서업무 목록 {EXISTING}와 90%+ 유사하면 existing_match에 표기. 출력 JSON 배열."

### 1.4 UI `DeptTaskSuggestPanel.tsx` (DailyTaskSelector 기반 신규)
부서업무 탭 상단 "✨ AI로 후보 찾기" → 패널: 기간 선택 → 후보 체크박스 목록(중복의심 badge+기본해제, confidence 표시, source 인용 툴팁) → 담당자/마감 인라인 조정 → "선택 N개 등록" → `createDeptTasksBulk` → SWR mutate + toast.

### 1.5 등록 (bulk)
`dept-tasks/actions.ts`에 `createDeptTasksBulk(inputs[])` 추가 — 기존 `createDeptTask` 루프 호출(RLS·트리거 그대로). 담당자 지정은 D-3(부서장) 규칙·076 트리거가 강제.

## 2. ② 메뉴 통합 IA — 설계 (DC-RES 패턴 A: 중첩 라우트+공유 layout)

### 2.1 구조 (권장)
```
app/(member)/work/
  layout.tsx     ← 공유 탭바(WorkTabBar) + 진입
  page.tsx       ← redirect → /work/daily (기본 탭)
  daily/page.tsx   (= 기존 일일업무 내용 이동/위임)
  dept/page.tsx    (= 부서업무 + ①AI 후보 패널)
  weekly/page.tsx  (= 주간보고)
```
- `components/ui/WorkTabBar.tsx`: weekly-report `tabStyle()` 추출, `usePathname()`로 active 감지, 3탭 Link.
- 사이드바 `layout.tsx` NAV: 일일/부서/주간 3항목 → **"업무"(/work) 1항목**. 캘린더/조직도 등은 유지.
- 기존 `/daily`·`/dept-tasks`·`/weekly-report` → `redirect('/work/...')` 한 줄(북마크 보존).
- 각 탭 내부 기존 서브탭 유지(일일: 일간/주간/메모, 주간: 내보고/팀/조직현황) — 상위 탭 아래 중첩.

### 2.2 대안 (참고)
- ?tab= 쿼리 단일 page: 단순하나 탭별 독립 SSR/데이터페칭 불가 → 주간보고의 대용량 서버로딩과 안 맞음. **미채택**.

## 3. 신규/재사용/확장 경계
- **재사용**: org-scope·gemini-daily-to-weekly·analyze-work 패턴·ai_prompts·token-logger·DailyTaskSelector·dept-task-utils·createDeptTask·tabStyle.
- **신규(최소)**: `/api/ai/suggest-dept-tasks` 1 · `ai_prompts` 1행 · `DeptTaskSuggestPanel` 1 · `createDeptTasksBulk` 1 · `WorkTabBar` 1 · `work/` layout+3 page(대부분 기존 내용 이동).
- **DB 변경**: 없음(기존 daily_logs/dept_task/weekly_reports/ai_prompts 사용). 임베딩 군집은 후속(현재 일반 로그 embedding 미적재).

## 4. 미해결 결정 (사용자 확인)
- **R-1 라우트명**: `/work`(업무) vs `/tasks` — CEO 권고 `/work`(라벨 "업무").
- **R-2 일일업무 'use client' 이동**: daily는 클라이언트 컴포넌트 → `/work/daily`로 옮길 때 그대로 이동 vs 기존 유지+상위 탭바만. CEO 권고: 라우트 이동(중첩), 기존은 redirect.
- **R-3 AI 후보 위치**: 부서업무 탭 상단 패널 vs 별도 "AI 제안" 탭. CEO 권고: 부서업무 탭 상단 패널(맥락 일치).
