# 01 · 아키텍처 — 3중 방어 (Defense in Depth)

> "유실 0"은 단일 수정으로 보장 못 한다. **경로를 하나로 줄이고(예방) + 매 저장 스냅샷(복구) + 로깅(관측)** 3층으로 겹친다.

## 현재 (문제) 구조

```
[메인 폼 저장] actions.upsertWeeklyReport ─┐
                                          ├─→ replace_weekly_report RPC ─→ weekly_reports
[AI초안 PUT] draft/route.ts ──────────────┘     (전체 DELETE + INSERT)
   └─→ replace_weekly_report_items ─→ weekly_report_items

문제: 두 writer가 같은 (user,week)를 파괴적으로 덮음. 서로 모름.
      작은 행셋으로 들어온 저장이 이김 → 나머지 소실. 스냅샷/복구 없음.
      141 이후 RPC 무로깅 → 파괴 순간 흔적 없음.
```

## 목표 구조

```
AI초안 · 미처리메모 · 일일보고 ──[폼에 반영]──▶ 화면 폼 state (클라이언트)
                                                   │  사용자 검토/편집
                                                   ▼
                          ┌──────────────────────────────────────┐
                          │ upsertWeeklyReport  (유일한 확정본 writer) │
                          └──────────────────┬───────────────────┘
                                             ▼ RPC (단일 트랜잭션)
                       replace_weekly_report:
                         1) 현재 확정본 전체 → weekly_report_snapshots  (DELETE 전, 스냅샷)
                         2) DELETE (user,week)
                         3) INSERT rows (seq 유지)
                         4) weekly_report_activity 기록 (create/edit, dept, content_hash)
                                             ▼
                                       weekly_reports

[AI초안 PUT] draft/route.ts ─→ replace_weekly_report_items ─→ weekly_report_items 만
   (확정본 sync 제거 — 더 이상 weekly_reports를 건드리지 않음)

[편집 이력 UI] weekly_report_snapshots 조회 → [복원] → 폼 로드/확정본 복원(이 역시 위 단일 writer 경유)
```

## Layer 1 — 단일 Writer (예방: 원인 ② 제거)
- **변경**: `draft/route.ts` PUT에서 `replace_weekly_report(확정본 sync)` 호출부 제거. items 저장까지만.
- **불변식**: `grep "replace_weekly_report(" | rpc('replace_weekly_report'` 결과가 `actions.upsertWeeklyReport` 1곳(+복원 액션이 재사용) 외 없음.
- **UX 무변경**: "폼에 반영"은 원래도 클라이언트 state 반영이 기본. 백그라운드 확정본 쓰기만 사라지므로 사용자 체감 흐름은 동일(오히려 예측가능).

## Layer 2 — 저장 전 스냅샷 + 사용자 복원 (복구: P0 보루)
- **신규 테이블** `weekly_report_snapshots` (append-only, 02 스키마 참조).
- **적재 지점**: `replace_weekly_report` RPC 내부, DELETE 직전. 같은 트랜잭션이라 "스냅샷 없이 삭제" 불가능.
- **내용**: 그 순간 확정본 전체를 `rows_json`(jsonb 배열)으로. 저장 사유(`reason`) 태깅.
- **복원 경로**: UI에서 스냅샷 선택 → 그 rows를 (a)폼으로 로드해 사용자가 확인 후 저장, 또는 (b)즉시 확정본으로 복원(내부적으로 동일 단일 writer 호출 → 복원 직전 상태도 스냅샷됨).
- **효과**: Layer 1/3에 잔여 버그가 있어도 **사용자가 스스로 되살림** = 진짜 유실 0.

## Layer 3 — 감사로깅·부서·content_hash 복원 (관측: 원인 ③ 되돌림)
- `replace_weekly_report` = **마이그120(로깅+dept) + 마이그141(seq)** 병합 버전으로 재정의.
- `weekly_report_activity`에 create/edit + department_id + content_hash 기록 → 지연판정(timeliness)·부서 가시성 정상화 + 저장 추적.

## 왜 이 조합인가 (설계 근거)
- Layer 1만으로도 이번 유실 경로(②)는 막힌다. 그러나 "절대 유실 금지" 원칙은 **미래의 알 수 없는 버그**까지 커버해야 한다 → Layer 2가 보루.
- Layer 2(스냅샷)는 순수 추가라 어떤 기존 동작도 깨지 않는다(트레이드오프 없음).
- Layer 3는 141이 되돌린 것을 복구 + 분쟁 대비 증빙. 142(project_activity)가 projects엔 after_snapshot을 넣었는데 주간보고엔 없던 공백을 메움.

## 경쟁 저장(더블-세이브) 대응
- 07-06 로그의 7초 간격 더블세이브 → 단일 writer + 매 저장 스냅샷이면 뒤 저장이 앞을 덮어도 **앞 상태가 스냅샷에 남아 복원 가능**.
- (P2, 선택) 낙관적 동시성: 폼 로드시 `loaded_at` 토큰 → 저장시 확정본 max(created_at) 역전 감지 시 사용자 확인. 이번 범위 밖(스냅샷으로 이미 안전) — 04 완료기준엔 미포함, 백로그.

## 영향 범위 (파일)
- DB: 신규 마이그 `143_weekly_report_snapshots.sql` (테이블+RLS+RPC 재정의).
- BE: `app/api/weekly-report/draft/route.ts` (sync 제거), `app/(member)/weekly-report/actions.ts` (복원 액션 추가).
- FE: 편집이력 패널 + 복원 모달 (신규 컴포넌트), 주간보고 페이지 배선.
- 서버조회: `page.tsx`에 스냅샷 로드 추가.
