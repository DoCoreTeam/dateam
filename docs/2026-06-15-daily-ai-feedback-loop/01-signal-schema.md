# 01 — 수집 신호 정의 + 저장 스키마

## 어떤 행동이 신호인가
AI가 자동 셋팅한 항목(source_type='ai_split'/'thread_derived', ai_processed=true)에 대한 사용자 후속 행동:

| 신호(signal_type) | 발생 지점 | 의미 | 라벨 |
|---|---|---|---|
| `reject` | 분해 항목 **삭제** | 오분해 / 불필요 | 부정 |
| `correct_content` | 제목 **수정** | 표현 교정(정답=after) | 정답쌍 |
| `correct_type` | entry_type **변경**(예 planned→done) | 분류 오류 | 정답쌍 |
| `correct_date` | target_date/scheduled_at **변경** | 일정 추출 오류 | 정답쌍 |
| `schedule_reject` | 캘린더 자동등록 **취소**(unlink) | 일정 오탐 | 부정 |
| `accept` | 일정 기간 내 **무수정 유지** | 정답(암묵) | 긍정(추정) |
| `split_reject`(파생) | 한 origin_group에서 다수 reject | 과분할 신호 | 부정(그룹) |

> `accept`는 즉시 이벤트가 아니라 **배치 추정**(예: 저장 후 24h 내 미수정/미삭제 → accept 1건). 노이즈 줄이려 명시 행동(reject/correct/schedule_reject) 우선.

## 저장 스키마 (신규 테이블 `ai_feedback_signals`)
```sql
-- (기획안) RLS: 본인만 select/insert. 집계는 서버(admin client)로 전역도 산출.
CREATE TABLE ai_feedback_signals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  log_id        uuid,                         -- 대상 daily_log (삭제돼도 신호는 남기려 FK 약결합/ON DELETE SET NULL)
  origin_group_id uuid,                        -- 묶음 단위 분석용
  prompt_version text,                         -- 그 분석에 쓰인 ai_prompts 버전(되먹임 평가용)
  signal_type   text not null check (signal_type in
                 ('reject','correct_content','correct_type','correct_date','schedule_reject','accept','split_reject')),
  field         text,                          -- 수정 필드(content/entry_type/target_date 등)
  before_value  text,                          -- 교정 전(또는 원본 분해 결과)
  after_value   text,                          -- 교정 후(정답)
  original_input text,                          -- 그 항목의 원본 입력(맥락; few-shot 재료)
  ai_confidence numeric,                        -- 당시 AI 신뢰도(저신뢰 거부 분석)
  created_at    timestamptz not null default now()
);
CREATE INDEX idx_afs_user_created ON ai_feedback_signals (user_id, created_at DESC);
CREATE INDEX idx_afs_type ON ai_feedback_signals (signal_type, created_at DESC);
```
- `ai_prompt_outcomes`와 분리(그건 프롬프트 품질 집계용, 이건 사용자 교정 원천 신호). 단, 집계 결과는 `ai_prompt_outcomes`로도 환원 가능.

## 수집 훅 위치 (기존 액션에 1줄씩 부착)
- 삭제: `deleteDailyLog` → ai_processed 항목이면 `reject` 신호 기록.
- 수정: `updateDailyLog` → 변경 필드 비교해 `correct_*` 신호(before/after).
- 캘린더 취소: `unlinkDailyCalendar` → `schedule_reject`.
- 수용(배치): 크론/지연 잡 — 저장 후 24h 미수정·미삭제 항목 → `accept`. (또는 주간 집계 시 산출)

## 프라이버시/격리
- 본인 RLS. 전역 패턴은 **익명 집계치**(개별 텍스트 노출 없이 빈도/비율)만 사용 권장.
- original_input/after_value는 민감할 수 있어 **본인 되먹임에만** 원문 사용, 전역은 통계만.
