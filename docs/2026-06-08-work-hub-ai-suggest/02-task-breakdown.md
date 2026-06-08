# 업무 허브 + AI 추출 — 작업 분해 (기획)

> 2026-06-08 · **구현 0**. 향후 착수 시 순서 제안. DC-BIZ 권고: ②(그릇) → ①(AI).

## 스프린트 0 — 사용자 확정 (선행, 코드 0)
- [ ] R-1 라우트명(/work vs /tasks) · R-2 일일 라우트 이동 방식 · R-3 AI후보 위치 확정
- [ ] AI 트리거 정책(수동만) · 기간 캡(2주/최대4주) · 호출 상한 확정

## 스프린트 1 — ② IA 통합 (Frontend, DB 0)
- [ ] T1 `components/ui/WorkTabBar.tsx` — weekly tabStyle 추출, usePathname active, 3탭
- [ ] T2 `app/(member)/work/layout.tsx`(탭바) + `page.tsx`(→/work/daily redirect)
- [ ] T3 `work/daily`·`work/dept`·`work/weekly` page — 기존 3페이지 내용 이동/위임(서브탭 보존)
- [ ] T4 사이드바 NAV: 3항목 → "업무"(/work) 1항목
- [ ] T5 기존 `/daily`·`/dept-tasks`·`/weekly-report` → redirect('/work/..') (북마크 보존)
- ✔ 완료기준: 3탭 전환·기존 URL 리다이렉트·반응형(table-card/탭) 정상, 디자인 §2-1/§2-2 준수

## 스프린트 2 — ① AI 추출 백엔드
- [ ] T6 `ai_prompts`에 `dept-task.suggest` 프롬프트 1행(추출+근거강제+dedup 지시)
- [ ] T7 `app/api/ai/suggest-dept-tasks/route.ts` — org-scope 권한·기간/상태 필터·기존제목 주입·Gemini JSON·가드(quote/confidence/캡)·logTokenUsage
- [ ] T8 `createDeptTasksBulk(inputs[])` (createDeptTask 루프 재사용)
- ✔ 완료기준: 권한(부서장만 dept) 검증, 환각가드 동작, 비용로그 기록, 단위테스트

## 스프린트 3 — ① AI 추출 UI
- [ ] T9 `DeptTaskSuggestPanel.tsx`(DailyTaskSelector 기반) — 기간선택·후보 체크목록·중복badge·confidence·source툴팁·담당자/마감 인라인·일괄등록
- [ ] T10 부서업무 탭(work/dept) 상단에 "✨ AI로 후보 찾기" 패널 연결 + SWR mutate/toast
- ✔ 완료기준: 부서장/본인 시나리오 동작, 디자인 표준 클래스(input-field/label) 준수

## 스프린트 4 — 검증/마무리
- [ ] T11 단위(추출 파서/가드/bulk) + E2E(권한별 추출·등록·리다이렉트)
- [ ] T12 🟥 DC-QA/SEC/REV(특히 AI 권한·비용·환각, 리다이렉트)
- [ ] T13 GATE 1-5 + 테스트데이터 정리 + 버전·docs + commit(push 사용자)

## 의존
S0 → S1(IA) → S2(AI BE) → S3(AI UI) → S4. S1·S2 일부 병렬 가능.

## 리스크 메모
- AI 첫 품질이 신뢰 임계 못 넘으면 사장 → MVP "수동+후보제안+가드" 필수.
- 비용 무가드 폭주 → 기간/상한/토큰로그 1순위.
- IA 이동 시 daily 'use client'/weekly 대용량 서버로딩 경계 유지(중첩 라우트로 분리 보존).

---
## ✅ 구현 완료 (2026-06-08, v0.7.52, /ceo-ralph)
- ②IA: WorkTabBar(공유 탭바)+/work redirect+NAV "업무" 1항목+3페이지 탭삽입+MobileShell active(match). 라우트 이동 없이 최소변경(DECISION#1).
- ①AI: lib/gemini-suggest-tasks.ts(추출엔진,프롬프트인젝션가드)+/api/ai/suggest-dept-tasks(org-scope권한·기간캡·상태필터·logTokenUsage)+createDeptTasksBulk(50상한)+DeptTaskSuggestPanel(체크→일괄등록).
- 검증: 단위36/36·E2E 3/3(work-ia·dept-tasks 트리거)·tsc0·design. 라이브: IA 탭전환·AI 8후보 실추출(신뢰도/근거). DC-QA/SEC/REV PASS-WITH-NOTES(88), 실효 이슈 반영(사이드바active·mine dedup·인젝션가드·register catch·고아import).
- 후속(별도): rate-limit, 부서원수 캡, suggest 파서 단위테스트, AbortController, bulk revalidate 1회, ai_prompts 이관.
