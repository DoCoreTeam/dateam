# 업무 허브 통합 활동이력 탭 (v0.7.287)

> 상태: 구현 완료 · 2026-07-06
> 배경: v0.7.286에서 '이력'을 프로젝트 카드별로만 구현 → 사용자 의도는 **일일·주간·부서·프로젝트 전체를 아우르는 통합 이력 탭**(프로젝트 현황 옆). 이번에 확장.

## 아키텍처 (유기적 통합)
- **통합 `activity_log`**(마이그143, append-only+RLS): 로깅이 없던 **일일업무·부서업무**(daily_logs 기반)를 기록. module/action/status/before/after/error/evidence.
- **SSOT `lib/work/activity-log.ts` `logActivity()`**(best-effort, throw 안 함) — daily/dept 서버액션이 성공·실패 양쪽 호출.
- **주간·프로젝트는 기존 로깅 재사용**: `weekly_report_activity`(120)·`project_activity`(142)를 그대로 두고, 이력 탭 API가 **세 소스를 UNION 정규화**해 한 피드로. (weekly RPC 내부 수술·회귀 회피)

## 구현
| 영역 | 내용 |
|---|---|
| DB | `143_activity_log.sql` — activity_log(append-only, RLS select user/actor=auth.uid, insert actor=auth.uid) |
| 로거 | `lib/work/activity-log.ts` — logActivity SSOT + 라벨맵 + ActivityFeedItem 정규화 타입 |
| 일일 훅 | `daily/actions.ts` 10개 액션(create/update/status_change/delete/promote/memo/bulk…) 성공·실패 로깅 |
| 부서 훅 | `dept-tasks/actions.ts` 7개 액션(create/promote/status_change/update/assign/delete/comment) |
| 읽기 API | `api/work/activity/route.ts` — 3소스 UNION 정규화·최신순 병합·page/limit·module[]/status 필터·본인 스코프 |
| 탭 | `WorkTabBar.tsx` '이력' 탭(/work/activity) — 프로젝트 현황 옆 |
| 피드 | `work/activity/page.tsx` — 모듈칩·상태 서브탭·상태색 배지·저장값 펼침·더보기 |

## 검증
- tsc PASS · design:check PASS · 754 테스트 PASS · 마이그143 적용 완료
- DC-REV 리뷰

## 비고
- v0.7.286의 프로젝트 카드별 '이력' 드로어는 존치(프로젝트 상세 뷰). 통합 탭이 상위 개요.
- 이월(carryover) 등 초고빈도 액션은 계측 제외(노이즈 방지).
