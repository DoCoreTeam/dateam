# 업무 허브 + AI 추출 — 테스트 전략 (기획)

> 2026-06-08 · 구현 0. 향후 적용 계획. 테스트데이터 [TEST] 표식+종료 시 삭제(운영 무오염).

## 1. ① AI 추출 — 단위
- 후보 파서: Gemini JSON → ExtractedCandidate[] 정규화, 깨진 JSON 방어.
- 가드: source_quote=null/confidence<0.7 제외, 기간 캡(>4주 거부/요약대체), 상태 필터.
- dedup: 기존 부서업무 제목과 유사 시 existing_match 표기.
- `createDeptTasksBulk`: 부분 실패 처리(일부 트리거 거부 시 나머지 등록 + 결과 리포트).

## 2. ① AI 추출 — 권한/통합 (보안 핵심)
- 부서장: dept 범위 호출 → 관할 부서원 로그만 추출(org-scope). 타부서 user_id 주입 시 거부.
- 일반 사용자: dept 호출 차단, 본인 범위만.
- 등록 시 담당자=부서 소속 강제(076 트리거) 재확인.
- 비용: `logTokenUsage` 기록 확인, 기간/상한 동작.

## 3. ② IA 통합 — E2E (Playwright)
- 사이드바 "업무" 1항목 → /work → 기본 탭(daily) 리다이렉트.
- 탭 3개 전환(daily/dept/weekly) + 각 내부 서브탭 보존.
- 기존 URL(`/daily`,`/dept-tasks`,`/weekly-report`) → 301 리다이렉트 확인.
- 반응형 320/768/1024/1440: 탭바·table-card 무overflow, 터치 44px.

## 4. ① AI 추출 — E2E (다층)
- 부서장 로그인 → "AI로 후보 찾기" → 후보 노출 → 체크 일괄 등록 → 부서업무 탭 반영.
- 본인 범위 추출. 중복의심 표시. (REST/시뮬레이션 패턴, dept-tasks.spec.ts 재사용)

## 5. 디자인/접근성
- `pnpm design:check` + §2-1/§2-2(폼 input-field/label, 모달/패널 표준) 대조.
- 후보 목록 키보드 선택, aria, 색대비.

## 6. 비용/성능
- 부서 10명×2주 ≈ 35K 토큰(≈$0.005) 허용, 4주↑ 요약대체. N+1 없이 단일 fetch.
- AI 호출 수동 트리거만(화면진입 자동호출 금지).
