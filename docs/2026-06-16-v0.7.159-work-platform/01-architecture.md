# 01 아키텍처 — 업무 플랫폼 확장

## ④ 통합 검색
- DB: `daily_logs.content` trgm GIN 인덱스(mig). weekly_reports는 perf/plan/issues HTML → 검색 시 서버에서 htmlToPlain 후 ilike(초기), 추후 plain 미러 컬럼 고려.
- BE: `GET /api/work/search?q=&cursor=&types=` — 3 소스 병렬 쿼리:
  - daily personal: daily_logs where user_id=me, task_kind='personal', content ilike
  - dept_task: daily_logs task_kind='dept_task', org-scope(readableDeptIds) RLS, content ilike
  - weekly: weekly_reports (user_id=me + 팀가시범위 정책), htmlToPlain 매칭
  - 각 결과 { type, id, title/snippet, date, href } 정규화 + 합쳐서 정렬/커서.
- FE: 글로벌 검색창(MobileShell 헤더) + `/work/search?q=` 결과 페이지(type 그룹/필터, 로딩·빈·에러, URL q 동기화).

## ② 부서 릴레이션
- BE: 일일 로그 조회 시 promoted dept_task 존재여부(역링크: dept_task where promoted_from_log_id=logId). 부서업무 상세에 원본 일일(promoted_from_log_id→daily_logs) + 작성자/담당자 이름 resolve(nameMap).
- FE: 일일 renderCard에 "부서업무 연결됨" 뱃지(데이터 기반, 영속) + 부서업무 상세/목록 원본·행위자 표시.

## ③ AI 프로젝트 그룹핑 (모델 결정 = Phase3 WEIGHTED DECISION)
- 후보: (1)경량 projects 테이블+work_entity_links kind='project'+임베딩 (2)deal 재사용 (3)동적 클러스터.
- 현황: group-logs.ts에 project 축 추가. autolink가 프로젝트 매칭/생성.
- 병렬 work-grouping-dashboard-plan과 정합.

## 재사용 자산
promoted_from_log_id, 임베딩+match RPC, pg_trgm, org-scope, html-to-plain, group-logs.ts, requireMemberApi.
