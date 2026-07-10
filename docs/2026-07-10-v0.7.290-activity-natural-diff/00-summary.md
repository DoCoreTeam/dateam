# v0.7.290 — 이력 탭 변경내용 자연어화 + 수정 전/후 diff

## 작업 요약
업무 허브 통합 이력 탭(`/work/activity`)이 저장 스냅샷을 **raw JSON 덤프**로 보여주던 것을,
**사람이 읽는 필드단위 변경 목록**으로 교체. 수정(update)은 `레이블: 이전값 → 새값`으로 표시해
무엇이 바뀌었는지 눈으로 보고 되살리기(복구)를 판단할 수 있게 함.

## 문제 (실제 렌더 경로)
- `app/(member)/work/activity/page.tsx` `저장된 값 보기` → `JSON.stringify(it.after)`로 DB 행 전체
  (id·embedding·user_id·ai_processed 등 내부 컬럼 포함) 덤프 → 사용자에게 무의미.
- 피드 아이템이 `after`만 보유. audit_log(마이그146)에는 `before_json`이 있으나 API가 버려
  **수정 전/후 비교 불가** → 되살리기 근거가 화면에 없음.

## 수정 파일
| 파일 | 변경 |
|------|------|
| `lib/work/activity-diff.ts` (신규) | 변경내용 자연어화 SSOT — 필드 한글라벨·값 포맷(우선순위/상태/진행률/체크리스트/HTML실적)·`diffSnapshots(action, before, after)` |
| `lib/work/activity-diff.test.ts` (신규) | 8 케이스 — 값 포맷·update/create/delete diff·객체동일판정 |
| `lib/work/activity-log.ts` | `ActivityFeedItem`에 `before` 필드 추가 |
| `app/api/work/activity/route.ts` | audit_log 경로가 `before: beforeJ` 전달(activity_log는 null) |
| `app/(member)/work/activity/page.tsx` | raw JSON `<pre>` 제거 → `ChangeList` 컴포넌트(자연어 diff) 렌더 |
| `lib/work/project-display.ts` | `./project-fields` → `./project-fields.ts`(테스트 러너 해상용, 레포 컨벤션) |

## 변경 이유
사용자 지적: "이력이 JSON으로 나오면 안 되고 자연어로. 수정은 전/후가 있어야 복구가 된다.
실수를 회복하는 방향이어야 한다." → 되살리기가 이미 있으나 **무엇을 되살리는지** 화면에서
알 수 없던 UX 공백을 메움. 데이터(before/after)는 이미 감사로그에 존재 → 표시만 보강.

## 영향 범위
- 표시 전용 변경. DB 스키마·마이그레이션 무변경. 기존 되살리기(restore-action) 로직 무변경.
- 값 포맷/라벨은 기존 SSOT(`status-colors`·`project-display`·`html-to-plain`) 재사용 — 복붙 없음.

## 검증
- 유닛 8/8 PASS · `tsc --noEmit` 0 · `design:check` 통과.
- ⚠️ 브라우저 실화면 시각검증 미실행(로그인·실 audit_log 행 필요). 표시 전용·유닛 커버 기준으로 커밋.
