# 00 요구사항 — 업무 플랫폼 확장 (오픈 전)

근거: docs/2026-06-16-work-platform-plan/00-plan.md (현황조사).

## ④ 통합 검색
- 일일업무(personal)·부서업무(dept_task)·주간보고를 한 곳에서 키워드 검색.
- 결과에 type(daily|dept|weekly) 레이블, 권한 스코프(본인+조직 readableDeptIds), 페이지네이션, 결과 클릭 시 해당 화면 이동.
- 주간보고 HTML은 plain 변환 후 매칭.

## ② 일일↔부서 릴레이션 + 행위자
- 일일 행에 "부서업무로 연결됨" 영속 표시(promoted_from 역링크) + 클릭 이동.
- 부서업무 상세/목록에 원본 일일 인용 + 작성자(user_id)·담당자(assignee) 표시.

## ③ AI 프로젝트 그룹핑
- 현황(/work/overview)을 고객/딜 축 외 "프로젝트" 축으로도 그룹핑.
- AI(autolink/임베딩)가 업무를 프로젝트(예 "충남AI 프로젝트")에 매칭.

## 공통 비기능
- RLS/org-scope 권한. 디자인토큰 SSOT. 신규 의존성 0 지향. 가역 설계. 신규 엔티티는 Feature Defaults.
