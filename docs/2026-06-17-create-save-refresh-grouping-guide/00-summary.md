# 00-summary — create 저장 즉시반영 회귀 수정 + 업무 그룹핑 가이드 (v0.7.178)

## 작업
1. **[버그] create 저장 후 목록 즉시 미반영 수정** — 일일업무에서 저장(Ctrl+Enter/버튼) 후 새로고침해야 목록에 나오던 회귀를 교정.
2. **[UX] 업무 그룹핑 가이드 추가** — "AI 예상 프로젝트"(군집 제안)와 일일 "원본 입력 묶음(분해)"이 무엇을 하는 기능인지 설명/툴팁을 노출.
3. 딜 추천(AI 자동연결)은 **변경하지 않음**(범위 보호).

## 수정 파일
- `app/(member)/daily/page.tsx` — 전역 `mutate` → `useSWRConfig().mutate`(Context). `DailyPage`·`ThreadView` 두 컴포넌트 모두.
- `components/ui/InfoHint.tsx` — **신설** 공용 툴팁(❓ HelpCircle + aria-label + native title). SSOT.
- `app/(member)/work/projects/ProjectAiSuggest.tsx` — 헤더에 가시 부제 + InfoHint, empty state 보강.
- `app/(member)/daily/OriginGroupCard.tsx` — `분해 N` 칩에 설명 title + InfoHint.

## 변경 이유 (근본 원인)
- 저장 미반영: `SWRProvider`가 `createPersistentProvider()`(localStorage 영속 캐시)를 Context에 주입하고 `revalidateIfStale:false`인데, `daily/page.tsx`만 `import { mutate } from 'swr'`(모듈 레벨 **전역** mutate)를 사용. 전역 mutate는 글로벌 기본 캐시만 무효화하고 Context 영속 캐시 인스턴스를 못 건드려, 저장은 서버에 됐지만(서버 액션 `revalidatePath` 정상) 클라이언트 목록 캐시가 갱신되지 않음 → 새로고침해야 보임.
- 전 create 플로우 감사 결과: 전역 mutate 오용은 **daily 한 곳뿐**. 가격 탭·모달은 이미 `useSWRConfig` 사용(정상). → daily만 고치면 "모든 create 즉시반영" 충족.
- 그룹핑: 화면에 기능 설명이 전무해 용어("분해", "AI 예상 프로젝트")만 노출 → 사용자 이해 곤란.

## 영향 범위
- 일일업무 저장/수정/삭제/이월/캘린더연결 등 daily 내 모든 SWR 갱신 경로(23+곳)가 Context mutate로 통일 → 저장 즉시 반영.
- DB 스키마 변경 없음. AI 자동연결/딜 추천 로직 무변경.
- InfoHint는 신규 공용 컴포넌트(향후 재사용 가능).

## 완료 조건
- [ ] daily 저장 후 새로고침 없이 목록에 즉시 표시 (수동/E2E 확인)
- [ ] tsc 0 오류
- [ ] design:check 통과
- [ ] ProjectAiSuggest·OriginGroupCard에 가이드 노출
- [ ] 딜 추천 동작 무변경
- [ ] 🟥 DC-REV PASS
