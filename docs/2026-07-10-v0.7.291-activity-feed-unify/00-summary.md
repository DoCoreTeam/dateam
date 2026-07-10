# v0.7.291 — 이력 피드 4원천 통합 + 일일 중복제거 + 주간 이전/이후

## 작업 요약
이력 탭(`/work/activity`)의 3가지 결함 수정 — 모두 **읽기 전용**(쓰기경로·마이그레이션 무변경).

## 사용자 지적 → 원인 → 해법
| 이슈 | 근본 원인(실데이터) | 해법 |
|------|--------------------|------|
| ① 일일 "생성" 동일내용 2건 | 원문 raw헤드(`ai_processed=false`+origin_group)와 AI분해 자식이 둘 다 audit_log에 insert되어 이중노출 | audit 피드에서 `isRawHead`(집계 SSOT)로 raw헤드 제외 |
| ② 필터 안됨/주간·프로젝트 없음 | v0.7.289가 피드를 audit_log(=일일만)로 축소 → 주간·프로젝트 원천 미포함 | 4원천 통합(아래) + module/status 필터 정확화 |
| ③ 주간 수정 이전/이후 없음 | `weekly_report_activity`엔 스냅샷 없음. 단 `replace_weekly_report` RPC(마이그144)가 저장마다 같은 txn에서 변경 전 상태를 `weekly_report_snapshots`(reason=manual_save)에 이미 캡처 | 활동↔스냅샷 페어링으로 before/after 도출(읽기). before=직전 스냅샷, after=다음 활동 스냅샷 또는 라이브 확정본 |

## 4원천 통합 (route.ts)
1. `audit_log`(daily_logs) — 일일·부서(task_kind 분기), before/after, raw헤드 제외
2. `project_activity` — 프로젝트, before_snapshot/after_snapshot, status 존중
3. `weekly_report_activity` + `weekly_report_snapshots` + 라이브 `weekly_reports` — 주간 before/after 페어링
4. `activity_log` — 앱단 실패/부분

## 수정 파일
| 파일 | 변경 |
|------|------|
| `app/api/work/activity/route.ts` | 4원천 통합·raw헤드 제외·필터·주간 페어링 |
| `lib/work/weekly-history.ts` (신규) | `resolveWeeklyBeforeAfter` 활동↔스냅샷 페어링 SSOT |
| `lib/work/weekly-history.test.ts` (신규) | 3 케이스(페어링·과거 스냅샷 없음·빈) |
| `lib/work/activity-diff.ts` | `diffWeeklyRows`(주간 rows_json 배열 diff, 카테고리행 단위) |
| `lib/work/activity-diff.test.ts` | 주간 diff 3 케이스 추가(총 11) |
| `app/(member)/work/activity/page.tsx` | ChangeList가 weekly면 diffWeeklyRows 분기 |

## 알려진 제약 (정직 보고)
- **기존 주간 수정 34건은 이전 내용이 물리적으로 저장된 적이 없음**(마이그144 이전) → 소급 복구 불가. `canDiff` 가드로 "없음→전체내용" 오표시 방지(과거 edit은 이벤트만 표시).
- **v144 이후 새 주간 저장부터는 before/after가 카테고리행별로 남음**(이전실적→이후실적).

## 🟥 DC-REV 반영
- **[CRITICAL 수정]** 주간 3개 쿼리(`weekly_report_activity`·`weekly_reports` live·`weekly_report_snapshots`)에
  `.eq('user_id', user.id)` 명시. weekly_reports(마이그002)는 로그인 전원 공개, weekly_report_activity(마이그120)는
  계층열람 허용이라 **RLS만으론 소유자 스코프 미강제** → 타 사용자 같은 주차 행이 `liveByWeek`에 섞여 diff 오염·열람초과
  위험을 제거.
- **[HIGH 부분대응]** 병합 정렬을 `occurred_at desc, id desc`로 안정화(슬라이스 비결정성 제거).
  **알려진 제약**: 커서가 단일 occurred_at 기반이라 경계에 동일 마이크로초 행이 여럿이면 일부 누락 가능
  (4원천 id타입 상이 → 완전 복합커서는 후속 과제). v0.7.289 커서 설계와 동일 — 신규 회귀 아님.

## 검증
- 유닛 766/766 PASS(신규 6 포함) · `tsc` 0 · `design:check` 통과
- 실데이터: 일일 id16(raw헤드) 제외·id17(AI자식) 표시 확인 → 중복 해소 검증
- ⚠️ 브라우저 실화면 시각검증 미실행(로그인 필요). 주간 새 저장 시 before/after는 실사용에서 확인 권장.
