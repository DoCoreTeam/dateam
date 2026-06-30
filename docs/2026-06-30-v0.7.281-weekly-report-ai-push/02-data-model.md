# 02 · 데이터 모델 / 마이그레이션 설계 (제안)

> 기획 문서. **실제 마이그레이션 실행 없음.** ADD→MIGRATE→DROP, 하위호환 원칙.

## 1. 현행 weekly_reports (변경 금지 컬럼)

```
weekly_reports(
  id, user_id, week_start(DOW=1),
  category TEXT, performance TEXT(HTML), plan TEXT(HTML), issues TEXT(HTML),
  created_at, updated_at, deleted_at,
  UNIQUE(user_id, week_start, category)
)
```
- 저장 = `replace_weekly_report` RPC (DELETE+INSERT 전체교체)
- 불변로그 = `weekly_report_activity`(create/edit/delete, actor_id, content_hash)

## 2. 전환에 필요한 신규 개념

push 전환은 "항목 단위 origin/confidence"와 "draft/confirmed 상태"가 필요하다. 현행 3개 HTML 필드(카테고리당 통짜)로는 **항목 단위 체크박스/X·출처태그**를 표현 못 한다. 두 가지 설계안:

### 안 A — 항목 테이블 신설 (권고)
```
weekly_report_items(
  id UUID PK,
  user_id UUID, week_start DATE,
  category TEXT,                       -- 구분(분류 1층)
  section TEXT CHECK(section IN ('performance','plan','issues')),  -- 분류 2층
  content TEXT,                        -- 항목 본문(plain 또는 경량 HTML)
  origin TEXT CHECK(origin IN ('auto','manual')),  -- 출처
  confidence NUMERIC,                  -- AI 신뢰도(0~1), manual은 NULL
  is_included BOOLEAN DEFAULT true,    -- 체크박스(제외 시 false)
  source_ref JSONB,                    -- provenance: {daily_log_id|calendar_event_id}
  sort_order INT,
  created_at, updated_at, deleted_at   -- 소프트삭제
)
-- RLS: user_id = auth.uid() (본인만), default-deny
```
- **장점:** 체크박스/X(is_included/deleted_at), origin/confidence, provenance를 자연스럽게 표현. 취합 시 origin 그대로 집계.
- **하위호환:** 기존 `weekly_reports`(통짜 HTML)는 **확정 스냅샷**으로 유지. items → 확정 시 카테고리별 HTML로 직렬화해 `weekly_reports`에 기록(기존 취합·표시 경로 무손상). 즉 items=작업영역, weekly_reports=확정본.
- **수동 에디터 영역:** origin='manual' 항목 또는 별도 `manual_body` 필드. (자유서술은 카테고리 밖일 수 있어 manual 전용 슬롯 권고)

### 안 B — weekly_reports 컬럼 확장 (경량)
```
ALTER weekly_reports ADD status TEXT DEFAULT 'confirmed';  -- 'draft'|'confirmed'
ALTER weekly_reports ADD draft_json JSONB;  -- 자동초안 항목들(origin/confidence/included)
ALTER weekly_reports ADD confirmed_by_actor TEXT;  -- 'user'|'system'
```
- **장점:** 마이그레이션 작음. 기존 테이블 유지.
- **단점:** 항목 단위 쿼리·취합이 JSONB 파싱 의존. 체크박스 상태가 JSON 안에 묻힘.

→ **권고: 안 A.** 항목 단위 조작(체크박스/X)·출처취합이 본 기획의 핵심이라 정규화 테이블이 정합·확장에 유리. 안 B는 MVP 축소판으로만.

## 3. 자동확정 / 공정성 (DC-BIZ 조건 ② 반영 — 필수)

> **자동확정분과 사용자확정분을 timeliness/인사 집계에서 분리한다.**

```
-- weekly_report_activity 또는 확정 스냅샷에 actor 구분 1급화
confirmed_actor TEXT CHECK(confirmed_actor IN ('user','system'))
-- timeliness 집계(timeliness.ts / timeliness-server.ts)는:
--   - '정시 실적' = confirmed_actor='user' 만 집계 (또는)
--   - user-confirmed / system-auto-confirmed 두 수치 분리 노출
```
- 자동확정(actor=system)은 **"누락 방지 백스톱"** 이지 "정시 제출 실적"이 **아니다.** 이 정의를 timeliness SSOT 주석/테스트로 못박는다.
- 기존 `weekly_report_activity`는 append-only 불변 — 자동확정도 `action='create'/'edit'` + `actor_id=system`으로 기록(정책 일관).

## 4. 캘린더 연결 (FR-4)

- 신규 테이블 불필요. `calendar_events`를 `kstRangeToUtc(weekStart, weekStart+6)`(성과용)·`(weekStart+7, weekStart+13)`(계획용)로 조회해 AI 입력에 주입.
- 선택: `calendar_events.link_kind='weekly'`(기존 미사용 스키마)로 "이 일정이 어느 주간보고 항목으로 반영됐는지" 역링크 — P2.

## 5. 마이그레이션 안전 원칙 (메모리 정책 반영)

- 기존 행의 상태 플래그 **무단 덮어쓰기 금지**(예: 기존 weekly_reports를 일괄 status='confirmed'로 백필 시 신중 — 과거분은 이미 확정으로 간주가 맞으나 명시적 검증).
- ADD(컬럼/테이블) → 코드가 신규 경로 사용 → 구 경로 충분 검증 후에만 정리. 한 마이그레이션에 DROP 섞지 않음.
- RLS는 신규 테이블에 **반드시** default-deny + 본인 스코프.
