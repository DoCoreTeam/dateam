# v0.7.293 — 전 모듈 되돌리기(복원) 통합 + 프로젝트 화면 확장

## 배경
사용자: "CRUD 다 기록되는데 왜 복원이 없냐. AI 오작동 시 되돌려야. 이력이 남으니 실제 화면에서도
되돌리기가 돼야. 확장적으로, 에러없이, 실시간." → 이력 탭 전 모듈 되돌리기 완성 + 각 화면 확장.

## 진단 (실코드·실데이터)
- CRUD 기록: 일일/부서=audit_log, 주간=audit_log+snapshots, 프로젝트=project_activity — **모두 기록됨**.
- 복원 현황: 일일/부서=이력탭 restoreFromAudit ✅ / 주간=주간화면 WeeklyEditHistory ✅(이력탭엔 버튼없음) /
  **프로젝트=복원 전무**. 실제 화면 노출도 일일/프로젝트엔 없음.

## 설계 (마이그레이션 없이 각 모듈 검증된 인프라 재사용 — 무오류 우선)
- 되살리기 참조 SSOT: `RestoreRef = {kind:'audit',ref:number} | {kind:'weekly',ref} | {kind:'project',ref}`
- 일일/부서 → `restoreFromAudit`(기존) · 주간 → `restoreWeeklyReportSnapshot`(기존, before-스냅샷 페어링으로 id 도출)
  · 프로젝트 → **신규 `restoreProject`**(project_activity.before_snapshot, whitelist·소프트삭제·IDOR가드)

## 수정 파일
| 파일 | 변경 |
|------|------|
| `lib/work/restore-action.ts` | `restoreProject(activityId)` 신규 — project_activity 근거 복원(컬럼 화이트리스트 재사용·소프트삭제 부활·소유자=인증사용자 IDOR 하드가드) |
| `lib/work/activity-log.ts` | `RestoreRef` 타입 신설, `ActivityFeedItem`: auditId/restorable → `restore: RestoreRef\|null` |
| `lib/work/weekly-history.ts` | `WeeklySnapshot.id` 추가, `BeforeAfter.beforeSnapshotId` 반환(주간 되살리기 대상) |
| `app/api/work/activity/route.ts` | 3원천에 `restore` 배선(audit/weekly/project), 스냅샷 id select |
| `app/(member)/work/activity/page.tsx` | 되살리기 핸들러 모듈별 분기(audit/weekly/project), 버튼 전 모듈 노출, 성공 시 mutate 실시간 |
| `app/(member)/work/projects/ProjectActivityDrawer.tsx` | raw JSON→자연어 diff, 프로젝트 화면 되돌리기 버튼 + router.refresh 실시간 |
| `lib/work/weekly-history.test.ts` | 스냅샷 id·beforeSnapshotId 검증 반영 |

## 복원 의미
- 수정(update/edit) → 이전값 롤백 · 삭제(delete) → 소프트삭제 부활(주간=스냅샷 재생성) · 생성(create) → before 없어 대상 아님.
- 되살리기 자체도 audit/activity에 다시 기록 → 되돌리기의 되돌리기 추적 가능.

## 실시간
- 이력탭: 되살린 후 `mutate()`로 피드 즉시 갱신 · 프로젝트 드로어: `router.refresh()` + 드로어 재조회.

## 완료 조건
- [x] 이력탭 4모듈(일일·부서·주간·프로젝트) 되살리기 동작
- [x] 프로젝트 화면(드로어)에 되살리기 + 자연어 diff
- [x] IDOR/화이트리스트/소프트삭제 방어 유지
- [x] tsc 0 · design · 766 테스트
- [ ] (후속) 일일업무 화면 per-항목 이력·되돌리기 드로어 — 현재 일일은 이력탭에서 복원(주간은 WeeklyEditHistory 존치)

## 🟥 리뷰 반영 (DC-SEC PASS · DC-REV APPROVED)
- **[SEC HIGH]** `project_activity_select` RLS `user_id OR actor_id` 과열람 → 마이그149로 `user_id` 단독(owner-only) 하드닝(마이그148 audit_log와 동일 패턴).
- **[REV CRITICAL]** 프로젝트 되돌리기 후 부모 목록 stale → `ProjectActivityDrawer onRestored` 콜백 → `mutate()` 실시간 갱신.
- **[REV HIGH]** `RESTORABLE_TABLES` 이중선언 → activity-log SSOT import. 순수 로직 `restore-core.ts` 분리 + `restore-core.test.ts` 6케이스('use server' async-only 규칙 해소). 주간 되살리기 = 페이지 경계 무경고 소실 방지: **커서 없는 1페이지의 주차별 최신 활동에만** 노출.

## 알려진 제약
- 프로젝트 활동 데이터가 아직 0건(project_activity) — 프로젝트를 수정/삭제해야 되살리기 대상이 생김. 로직은 검증 완료.
- 하드삭제(완전삭제)된 행의 재생성(INSERT 복원)은 미지원 — 소프트삭제 부활만.
