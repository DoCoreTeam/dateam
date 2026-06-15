# 01 — 현행 코드/데이터 정밀 매핑 (DC-ANA)

## 현행 데이터 흐름
```
입력 textarea
 → POST /api/ai/analyze-work {text,date}
    · ai_prompts active 'daily.analyze-work' (v2-quality) 로드
    · accounts/contacts 매칭 컨텍스트
    · daily_logs 오늘 항목 → {EXISTING_TODAY} 주입(중복 억제)
    · daily_log_origin_groups INSERT → originGroupId
    · Gemini streamGenerateContent (SSE, NDJSON 줄단위)
 → 클라이언트 SSE 수신 → AiResultPanel 실시간 카드
 → 사용자 체크 후 "확인 저장"
 → addMultipleDailyLogs(items): daily_logs 배치 INSERT
    (content=AI title, original_input=원본전문, origin_group_id, source_type='ai_split', ai_*)
    · note → memo_status='new' + 임베딩
 → 백그라운드 ai_prompt_outcomes 적재 + 자가조정
```

## daily 데이터 모델 — 핵심: 원본·분해가 `daily_logs` 단일 테이블
원본 전용 테이블 없음. 원본은 두 곳에 보존됨:
- `daily_logs.original_input` (분해 항목마다 같은 원본 전문 중복 저장)
- `daily_log_origin_groups.original_input` (입력 1회 anchor, `origin_group_id`로 연결)

주요 컬럼: `content`(분해 title), `entry_type`(done/doing/planned/blocker/note), `target_date`/`scheduled_at`(일정), `origin_group_id`(묶음 FK), `parent_log_id`(파생 부모), `source_type`(manual/ai_split/ai_derived/thread_derived), `memo_status`(new/reviewed/actioned), `embedding`(vector768).

연결 테이블: `daily_log_origin_groups`(원본 anchor), `daily_log_relations`(엣지 그래프), `daily_log_threads`/`_thread_logs`(스레드), `daily_log_tags`.

재사용 함수: `getOriginGroupLogs(originGroupId)`, `groupDailyLogs()`(origin_group 기준 클라 그룹핑), `addMultipleDailyLogs()`, `addRelation()`.

## AI 파이프라인 현황
- 라우트 `app/api/ai/analyze-work/route.ts` (SSE).
- 거버넌스 `lib/daily-prompt-governance.ts`(자가학습·degraded), 품질 `lib/daily-quality.ts`(과분할 판정).
- 임베딩 `lib/gemini-embedding.ts`(note vector768), 토큰 `lib/token-logger.ts`.
- 프롬프트 DB `ai_prompts`(active=v2-quality), 품질신호 `ai_prompt_outcomes`.
- 변수: {TODAY}{TOMORROW}{ACCOUNTS}{CONTACTS}{EXISTING_TODAY}.

## 3대 목표 커버리지 현재 상태
| 목표 | 상태 | 근거 |
|---|---|---|
| **중복 탐지** | **부분** — 프롬프트 {EXISTING_TODAY} 주입으로 AI가 억제. **결정론(코드) 중복제거 없음**. (lib/gpu/dedup은 GPU 전용·무관) |
| **캘린더 반영** | **미흡** — `target_date` 있는 daily_logs는 캘린더 화면이 직접 읽어 표시됨. 그러나 **analyze-work가 calendar_events 자동 INSERT 안 함**. `getCalendarRecommendations()`는 추천만(INSERT 없음). |
| **메모(note)** | **완비** — memo_status 흐름 + UnreviewedMemoWidget(우측 패널) + MemoPromoteModal(업무 승격) + 임베딩 유사 클러스터(/api/daily/memos/clusters). |
| (이월 미완료) | **완비** — getCarryoverLogs(7일 is_resolved=false planned/doing/blocker) + 우측 패널 3액션. |

## 재사용 vs 신규 (후속 기획 기준)
**그대로 재사용:** original_input(저장됨)·origin_groups·getOriginGroupLogs·groupDailyLogs·addMultipleDailyLogs·ai_prompts 거버넌스·daily_log_relations·임베딩/clusters.

**수정 필요:** analyze-work 라우트(중복 결정론 강화 시), AiResultPanel(드로어로 교체), addMultipleDailyLogs(원본 SSOT 정리 시).

**신규 필요:** ①원본 보존 드로어 UI(origin_group 기준 원본+분해 표시) ②daily→calendar_events 자동/확인형 생성 경로 ③중복 결정론 로직 ④"누락 정제"(이번주 planned 중 done 없음 등) 감지.
