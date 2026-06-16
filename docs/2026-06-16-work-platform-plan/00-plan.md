# 업무 플랫폼 확장 기획 (구현 전 — 보고용)

대상 3건: (2) 일일↔부서 릴레이션+행위자 (3) 현황 AI 프로젝트 그룹핑 (4) 일일/부서/주간 통합검색.
원칙: 신규 테이블 최소·기존 자산(임베딩·autolink·promoted_from·org-scope·html-to-plain) 재사용.

---
## (2) 일일업무 ↔ 부서업무 릴레이션 + "누가 어떤 일 했는지"
### 현황(사실)
- `daily_logs` 단일 테이블 + `task_kind`(personal/dept_task)로 구분. 일일→부서 연결 컬럼 **`promoted_from_log_id`(참조) 이미 존재**(mig104) + 재승격 멱등 UNIQUE(mig105).
- `promoteDailyToDeptTask`(dept-tasks/actions.ts:114) 단방향만. 승격 버튼은 **로컬 상태**라 새로고침 시 "연결됨" 소실.
- dept_task에 `user_id`(작성자)·`assignee_user_id`(담당자)·`department_id` 존재. 목록 쿼리는 `promoted_from_log_id`를 내려주나 **UI 미사용**.
- autolink는 personal 일일에만 동작 — dept_task 미적용.
### 기획
- **A. 일일 행 영속 뱃지**: `promoted_from_log_id` 역조회 → "부서업무로 연결됨" 뱃지 + 클릭 시 해당 부서업무로 이동(새로고침 유지).
- **B. 부서업무에 원본·행위자 표시**: dept_task 상세/목록에 원본 일일 인용 + 작성자(user_id)·담당자(assignee) 노출 = "누가 어떤 일 했는지". (nameMap/deptNameMap 재사용)
- **C(확장)**: dept_task 저장에도 autolink 큐 적재 → 일일↔부서 자동 연관(수동 promote 외).
### 재사용/난이도
재사용: promoted_from_log_id, nameMap, listDeptTasks(이미 필드 반환). **난이도 中** — 주로 역방향 쿼리+UI, 신규 테이블 불필요. A·B 우선, C는 후속.

---
## (3) 현황 그룹핑 — 고객/딜별 → AI 프로젝트 그룹핑
### 현황(사실)
- "현황" = `/work/overview`. 축 토글 `account|deal`, **본인 personal 일일만** 그룹핑(`group-logs.ts groupLogsByEntity`).
- **`projects` 테이블 없음.** `work_entity_links.kind`는 account/deal/contact만(project 없음). deal축은 사실상 공백.
- 재료: 임베딩(daily/account/deal/contact 768d)+ivfflat, `match_*` RPC, pg_trgm, work_entity_links.kind 확장 가능.
- ⚠️ **사용자 병렬 기획 `docs/2026-06-16-work-grouping-dashboard-plan/`과 직접 중복** — 통합 필요(중복 구현 금지).
### 기획 (프로젝트 개념 정의가 핵심 결정)
- **옵션1 (경량·권장)**: "프로젝트"를 `work_entity_links.kind='project'` + 경량 `projects`(id,name,embedding) 도입. autolink가 업무를 프로젝트명("충남AI 프로젝트")에 매칭/생성 → 현황에 `project` 축 추가.
- **옵션2 (재사용)**: deal을 프로젝트로 재사용(`deals.title`=프로젝트명). 신규 테이블 0이나 영업딜↔프로젝트 의미 혼선.
- **옵션3 (동적)**: 임베딩 클러스터링으로 프로젝트 그룹 동적 형성(엔티티 없이). 정확도·안정성 리스크.
- **팀 확장**: 현재 본인만 → 프로젝트별 팀 투입 보려면 org-scope로 범위 확장.
### 재사용/난이도
재사용: groupLogsByEntity(축 추가), 임베딩/match RPC, autolink. **난이도 中~上** — 프로젝트 개념 정의가 관건 + 병렬 기획 통합. **권장: 옵션1**, 단 work-grouping-dashboard-plan과 먼저 정합.

---
## (4) 통합 검색 — 일일/부서/주간
### 현황(사실)
- 검색 있는 곳: accounts/deals/contacts(`ilike`)만. **일일·부서·주간 검색 전무, 통합 라우트 없음.**
- daily_logs.content **trgm GIN 인덱스 없음**(LIKE 시 seq scan). weekly_reports는 HTML 리치텍스트 + **검색 인덱스 0, 임베딩 0**.
- 재사용: `htmlToPlain()`, `match_daily_logs` RPC(임베딩), `embedText()`, requireMemberApi/resolveOrgScope, ilike 패턴.
### 기획
- **신규 `/api/work/search`**: 3소스 UNION → `type`(daily|dept|weekly) 레이블 + 권한 스코프(본인+조직 readableDeptIds) + 커서 페이지네이션 + 로딩/빈/에러 UI + URL 동기화.
- **1차(키워드)**: daily_logs(content/original_input), dept_task(content, 조직스코프), weekly_reports(perf/plan/issues → `htmlToPlain` 후 매칭). **trgm GIN 인덱스 추가**(daily_logs.content) 권장. weekly_reports는 plain 미러/generated 컬럼 도입해 인덱싱.
- **2차(시맨틱, 선택)**: 임베딩 검색 병행(match RPC) — 쿼리 임베딩 Gemini 비용 고려, 키워드와 하이브리드.
- **UI**: 상단 글로벌 검색창 또는 통합 결과 페이지.
### 재사용/난이도
**난이도 中** — 포인트: weekly HTML→plain·trgm 인덱스·조직스코프·3소스 통합 응답. 주간보고 검색 성능 위해 plain 미러 컬럼 권장.

---
## 권장 순서 (CEO)
1. **(4) 통합검색** — 독립적·가치 명확·자산 풍부. 먼저.
2. **(2) 부서 릴레이션** — 컬럼 이미 존재라 비교적 빠름(A·B). 차순.
3. **(3) 프로젝트 그룹핑** — 가장 큰 설계결정 + 병렬 기획 통합 필요 → **work-grouping-dashboard-plan과 합의 후** 착수.
공통 전제: RLS/org-scope 권한, 신규 엔티티시 DOC-FIRST+Feature Defaults(CRUD/List/검색·정렬·필터/페이지네이션/URL상태) 박제.
