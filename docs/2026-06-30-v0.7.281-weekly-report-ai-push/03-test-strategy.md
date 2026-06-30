# 03 · 테스트 전략 (구현 시 적용 — 기획)

> 프로젝트 테스트 = node:test (apps/web `pnpm test` 파일목록에 수동 등록) + Playwright E2E.

## 1. 단위 테스트 (순수 로직 SSOT)

| 대상 | 검증 |
|------|------|
| `classifyToSection` | 일일업무(과거 완료)→성과 / +1주 일정→계획 / is_resolved=false→이슈 / "~예정" 표현→계획 보정 |
| 카테고리 참조계층 | 개인 지난주 카테고리 우선, 없으면 부서 카테고리 참조, 둘 다 없으면 AI 신규 |
| confidence 마커 | 임계값 이하 항목에 '확인요' 플래그 부여 |
| `timeliness` actor 분리 | actor=system 확정분이 '정시 실적' 집계에서 분리되는지 (**DC-BIZ 조건 ②**) |
| 자동확정 경계 | 토 00시/월 00시 KST 경계에서 미조정 draft가 confirm 대상이 되는지 (기존 judgeTimeliness 재사용) |
| 멱등/락 | 같은 user×week 중복 생성 요청 시 1건만 생성·기존 draft 미덮어쓰기 |

## 2. KST 정합 가드 (필수 — 기존 정책)

- 캘린더 주범위 조회가 `kstRangeToUtc`만 사용하는지 정적 스캔(`kst-guard.test`에 신규 경로 포함).
- naive 문자열 / `iso.slice` / `getHours` 우회 금지.

## 3. 통합 테스트

- `GET /api/weekly-report/draft`: 저장본 없음→생성+저장+200, 있음→재호출 없이 로드.
- 자동확정 cron 엔드포인트(또는 lazy 경로): 미조정 draft만 confirm, 사용자 수정분은 건드리지 않음.
- 취합: auto/manual 혼합 입력이 origin 태그 보존하며 `mergeAndRefineByCategory` 통과.

## 4. E2E (Playwright, throwaway 계정 — 실데이터 오염 금지)

1. 그 주 일일업무 N건 + 캘린더 일정 작성 → 주간보고 화면 진입 → **초안이 채워진 상태**로 뜨는지(스켈레톤 후).
2. 자동항목 체크박스 해제/X → 저장 → 재진입 시 반영 유지(AI 재호출 없음).
3. 수동 에디터 영역 작성 → 자동영역과 공존 저장.
4. 데이터 0건 주간 → 빈 자동영역 + 수동 에디터로 graceful degrade.
5. 기존 사용자 기존 주간보고 → 회귀 없이 표시·편집(하위호환).
6. (자동확정 단계 도입 시) 사전알림 노출 → 기한경과 → system 확정 → timeliness에서 actor=system으로 분리 표기.

## 5. 비용/성능

- 화면열때 생성이 **주당 정확히 1회**인지(중복 호출 카운터). token-logger 기록 확인.
- 첫 진입 LCP/로딩 UX(스켈레톤) 확인.

## 6. 검증 원칙 (프로젝트 정책)

- tsc/단위 통과만으로 "완료" 금지 → **실제 렌더 경로(`?tab=mine`) Playwright 실측**으로 확인.
- React18 — 새 훅 사용 시 `next build`로 런타임 검증(tsc 부족).
