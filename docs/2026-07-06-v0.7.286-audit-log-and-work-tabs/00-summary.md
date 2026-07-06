# 기획 보고 — 저장이력(감사로그) + 주간보고 다중기록 + 우측패널 일괄오퍼 + 업무 탭 재편

> 상태: **구현 완료** (v0.7.286) · 작성일 2026-07-06
> 근거: DC-ANA 3회 코드 실측 → 5개 항목 구현. tsc·design·749테스트 PASS, 마이그 141·142 적용 완료.
>
> ## 구현 결과 (v0.7.286)
> - **A** 감사로그: `142_project_activity.sql`(append-only+RLS), `lib/work/project-activity.ts`(SSOT), POST/PATCH/DELETE/ai_confirm 성공·실패 로깅, `api/projects/[id]/activity` GET, `ProjectActivityDrawer` + 카드 '이력' 버튼.
> - **B-1** 다중기록: `141_...sql`(seq 컬럼+UNIQUE 완화+RPC seq부여), `actions.ts` dedup 제거, prefill `.order('seq')`. → 무경고 유실버그 해소.
> - **B-2** team: 현행 유지(내보고=원문·org=AI취합 이미 충족).
> - **C** 인테이크 일괄오퍼: MemoIntakeList/DailyTaskSelector 마스터 체크박스(3-state) + 메모 '선택 확인' 일괄 소진.
> - **D+E** 탭: `WorkTabBar` 순서(일일→주간→부서→프로젝트현황)+현황 병합, `WorkOverviewPanel` 추출, `/work/overview` 리다이렉트, projects 페이지 [프로젝트|현황] 뷰스위치.

## 항목 개요
| ID | 요구 | 현행 판정 | 확정 방향 |
|----|------|----------|----------|
| A | 프로젝트 옆 "이력" — 성공/실패 모조리 로깅, 저장값 표시, 유기적 연계 | 이력테이블 0개, 실패는 console.error만(DB 미영속) | 전체액션+실패 append-only 로그 (확정) |
| B-1 | 주간보고 같은 카테고리 다중 기록 | UNIQUE(user,week,category)+Map dedup으로 1행 강제, 무경고 유실 | DB 제약완화+다중행 (확정) |
| B-2 | 내보고=원문 / 팀·조직=AI취합 | 내보고 원문 ✅, org AI취합 ✅, **team은 원본나열(AI無)** | team 현행유지+이름 명확화 (확정) |
| C | 우측 인테이크 패널 일괄 오퍼레이션 | 마스터 체크박스·일괄삭제 없음(DailyTaskSelector 버튼형 전체토글만, MemoIntakeList 전체토글 없음) | 마스터 체크박스 전체선택/해제 + 일괄 삭제 추가 |
| D | 탭 순서: 일일업무→주간보고→부서업무 | 현재 일일/부서/주간/현황/프로젝트 | 순서 재배열 |
| E | 현황을 프로젝트로 병합, 탭명 "프로젝트 현황" | 현황(/work/overview)·프로젝트(/work/projects) 별도 탭 | 병합 후 4탭 |

---

## A. 프로젝트 저장이력(감사로그) — 신규 `project_activity`

### 현행 (근거)
- 프로젝트 전용 이력 테이블 **없음** (마이그레이션 grep 부재)
- 저장 성공/실패 어디에도 DB 영속 안 함 — `api/projects/[id]/route.ts:30,72,96` 실패는 `console.error`만(서버로그, 사용자·관리자 조회 불가)
- "작성했는데 없다" 발생지점: `ProjectAiSuggest.tsx:49-66` AI확정 부분실패 시 성공분 롤백 없음·리프레시 없음→중복생성 위험 / 필터함정 `page.tsx:57-66`
- 재사용 레퍼런스: `weekly_report_activity`(120, append-only·RPC 트랜잭션 원자기록), `gpu_audit_logs`(024, action_type CHECK + detail jsonb)

### 기획: `project_activity` (append-only)
```
project_activity
  id uuid pk
  project_id uuid null            -- 생성실패 시 아직 id 없음 → null 허용
  actor_id uuid not null
  action text                     -- create|update|delete|ai_confirm|link_daily|unlink_daily|member_change
  status text                     -- success|failure|partial   ← "성공만 아니라 모조리"
  before_snapshot jsonb null
  after_snapshot jsonb null       -- "DB 저장됐다면 값도 보여주고"
  error_detail jsonb null         -- 실패 원인 영속
  evidence jsonb null             -- 요청 payload 요약 = "작성했다는 증거"
  occurred_at timestamptz         -- KST SSOT(kstNow)
```
- RLS: 본인 프로젝트 이력 SELECT + admin 전체. INSERT는 서버(service/RPC)만. UPDATE/DELETE 정책 없음(불변).
- 기록지점: `api/projects` POST/PATCH/DELETE + `work/projects/confirm` + `work_entity_links` upsert/삭제 각각 성공·실패 양쪽 insert.
- **AI확정 원자화**: `confirm`을 RPC 트랜잭션으로 → 부분실패 문제 동시 해소.
- 유기적 연계: projects↔daily_logs는 `work_entity_links(kind='project')` 다대다(101). link/unlink 액션도 이력에 포함.
- UI: 프로젝트 목록/상세 옆 "이력" 버튼→드로어 타임라인(성공초록/실패빨강/부분주황, after_snapshot 펼침, 실패 error_detail 표시). §5-3 준수.

## B-1. 주간보고 같은 카테고리 다중 기록
- 근본원인: `001_initial_schema.sql:82-83` UNIQUE(user_id,week_start,category) + `weekly-report/actions.ts:39-51` category-키 Map dedup(첫 행 무경고 유실)
- 기획: UNIQUE에 `seq`(또는 item_id) 추가로 완화(ADD→백필 seq=0→DROP old). actions.ts dedup 제거, 행별 개별저장. 표시=카테고리 그룹 내 순차 다중행.
- 파급: org 취합 `aggregateDept`는 이미 카테고리당 authors[] 다중 처리 → 호환. 검증 필요.

## B-2. team 탭 (현행유지)
- team(`TeamReportView.tsx:118-156`)=개인별 weekly_reports 원본 나열(AI無), org(`org-actions.ts:71-141`+`gemini-refine.mergeAndRefineByCategory`)=AI취합.
- 방향: 역할분리 유지. 라벨만 혼동 없게(예: "팀 원본"/"조직 취합") 정리 검토.

## C. 우측 인테이크 패널 일괄 오퍼레이션
- 현행: `DailyTaskSelector.tsx:184-193` 전체토글은 **버튼형**(마스터 체크박스 아님). `MemoIntakeList.tsx` 전체토글 **없음**. 둘 다 진짜 "삭제" 없음(MemoIntakeList는 reviewed 소진만, 그나마 "폼에 반영"에 종속).
- 오르판: `daily/actions.ts:939-957 bulkArchiveMemos` 미사용(구 WeeklyMemoReview 삭제로 고아).
- 기획:
  1. 두 리스트 상단에 **마스터 체크박스**(indeterminate 3-state: 전체/부분/없음)로 전체선택·해제 통일. DailyTaskSelector는 기존 toggleAll 버튼을 마스터 체크박스로 교체/병행.
  2. **일괄 삭제** 버튼 추가:
     - MemoIntakeList: 선택 항목 일괄 **확인처리(reviewed 소진)** — 반영과 분리된 독립 버튼. `bulkArchiveMemos`(고아) 재활용/정리 검토.
     - DailyTaskSelector: 일일보고 원본 삭제는 위험 → "이번 반영 대상에서 제외"(로컬) 또는 확인 후 daily_logs soft-delete 중 택1 (확정 필요).
  3. 삭제 액션도 A의 감사로그에 남기면 유기적 연계 완성.

## D+E. 업무 탭 재편 (`components/ui/WorkTabBar.tsx:10-16` TABS 배열)
현재:
```
일일업무 /daily · 부서업무 /dept-tasks · 주간보고 /weekly-report · 현황 /work/overview · 프로젝트 /work/projects
```
변경 후 (4탭):
```
일일업무 /daily · 주간보고 /weekly-report · 부서업무 /dept-tasks · 프로젝트 현황 /work/projects(현황 병합)
```
- D: 주간보고를 부서업무 앞으로.
- E: `현황`(/work/overview) 탭 제거 → `프로젝트` 라벨을 **"프로젝트 현황"**으로, /work/overview의 현황 뷰(축전환 `overview/page.tsx:47`)를 /work/projects 안으로 병합(서브탭/섹션 방식 확정 필요). `layout.tsx:37` match 배열에서 /work/overview 정리, 리다이렉트 검토.

---
## 확정 필요 (구현 착수 전 별도 확인)
- C-2 DailyTaskSelector 삭제 의미: 로컬 제외 vs daily_logs soft-delete
- E 병합 방식: 프로젝트현황 페이지 내 서브탭 vs 스크롤 섹션, /work/overview 리다이렉트 유지 여부
