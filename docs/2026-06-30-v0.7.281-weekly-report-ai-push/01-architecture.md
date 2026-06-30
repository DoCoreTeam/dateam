# 01 · 아키텍처 — 주간보고 AI push 전환

> 기획 문서. 구현 아님.

## 1. 현행 → 목표 흐름 대비

### 현행 (pull)
```
[화면 진입] → 빈 폼 (WeeklyReportForm)
   → 사용자가 DailyTaskSelector 펼침 → GET /api/daily/week
   → 체크박스 선택 → POST /api/weekly-report/generate-from-tasks
   → mergeWeeklyRows()로 폼에 병합 → 사용자 편집 → 저장(replace_weekly_report RPC)
```

### 목표 (push, 하위호환)
```
[화면 진입]
   → 저장된 해당 주 보고 있음?
      ├ 있음 → 저장본 로드 (AI 재호출 없음)
      └ 없음 → 자동초안 생성:
           GET 일일업무(/api/daily/week) + 캘린더(/api/calendar/events?주범위)
           → generateWeeklyDraft(일일+캘린더, 카테고리참조)  [기존 generateWeeklyFromDailyTasks 확장]
           → 카테고리×(성과/계획/이슈) 배치 + origin=auto + confidence
           → draft 저장 (status=draft)
   → 화면: 자동영역(체크박스/X 인라인) + 수동 에디터 영역 공존
   → 사용자 조정 → 저장 (origin 보존)
   → [기한경과+미조정] 사전알림 → 자동확정(status=confirmed, actor=system)
   → [취합] dept rollup: auto/manual 태그 보존하며 mergeAndRefineByCategory()
```

## 2. 레이어별 변경 지점

| 레이어 | 현행 | 목표 변경(설계) | 재사용 |
|--------|------|----------------|--------|
| **DB** | `weekly_reports`(category, performance, plan, issues HTML) | 자동/수동 항목·origin·confidence·draft를 담을 구조 추가 (02 데이터모델 참조) | 테이블 유지+확장 |
| **AI** | `generateWeeklyFromDailyTasks()` | 캘린더 입력 추가 + 카테고리 참조계층 + origin/confidence 출력 = `generateWeeklyDraft()` | 기존 함수 확장 ✅ |
| **API** | `generate-from-tasks`(POST, 사용자 트리거) | `GET/POST /api/weekly-report/draft`(없으면 생성·저장, 있으면 로드) 신설 | 기존 route 패턴 |
| **캘린더** | `/api/calendar/events?start&end` | 주범위(weekStart~+6, 계획용 +7~+13) 조회 후 AI 주입 | `kstRangeToUtc` ✅ |
| **FE** | `WeeklyReportForm`+`EditorModal`(셀 모달) | 자동영역 인라인 체크박스/X 렌더 + 수동 에디터 영역 분리. `DailyTaskSelector`는 fallback로 잔존 | RichText, EditorModal(수동영역) |
| **기한** | `timeliness.ts`(순수 판정, 실행기 없음) | **자동확정 실행기 신설**(cron 또는 트리거) + 사전알림 | judgeTimeliness/summarizeActivity ✅ |
| **취합** | 엔진B `aggregateDept`/`mergeAndRefineByCategory` | origin 태그 입력 보존 | 엔진B 그대로 ✅ |

## 3. 자동확정 실행기 (FR-6) 설계 옵션

| 옵션 | 방식 | 장점 | 단점 |
|------|------|------|------|
| A. 외부 cron | GitHub Actions/Vercel cron이 토/월 00시 KST에 미확정 draft를 confirm | 기존 인프라(CI) 재사용, 로직 JS로 명확 | 외부 스케줄 신뢰성·시크릿 |
| B. DB pg_cron | Postgres 측 스케줄 | DB 자족 | 프로젝트가 pg_cron 미사용, 신규 의존 |
| C. lazy 확정 | 다음 조회/취합 시점에 "기한 지난 draft면 그때 confirm" | 스케줄러 불필요 | 아무도 안 열면 영영 미확정 → 취합 누락 |

→ **권고: A(외부 cron) + C(lazy 백업)** 혼합. cron이 주 실행, 조회/취합 경로에서도 안전망으로 lazy 확정. (timeliness가 이미 토 00시/월 00시 경계를 SSOT로 가짐 → 그 경계 재사용)

## 4. SSOT / 재사용 정책 준수

- **분류·생성 로직**: `lib/weekly-report/`에 `generateWeeklyDraft`(AI)·`classifyToSection`(시점+의미 판정)·`draft-origin.ts`(origin/confidence 타입) 단일 구현. FE/API 공용 import.
- **datetime**: 모든 주범위·기한은 `lib/datetime/kst.ts`. naive 문자열 금지.
- **표시**: 자동/수동 모두 `RichText`(HTML)·`PlainQuote`(인용). 인라인 포맷 복붙 금지.
- **취합**: 엔진B SSOT 유지. 엔진A(aggregate-stream)는 v0.7.278 이후 부서선택 시 숨김 — 본 전환도 엔진B만 건드림.

## 5. 실제 렌더 경로 주의 (프로젝트 정책)

- 현행 기본 렌더 = `?tab=mine` → `WeeklyReportForm`. **flag 없음, 탭 분기만.**
- push 전환은 이 기본 경로를 직접 바꾼다. `DailyTaskSelector`는 제거하지 않고 "수동 보강" 보조 패널로 강등(하위호환).
- 검증은 반드시 `?tab=mine` 실제 화면(Playscreen)에서 — tsc/단위 통과만으로 "됨" 금지.
