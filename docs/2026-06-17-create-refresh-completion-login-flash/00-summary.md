# 00-summary — create 즉시반영 완성(4파일+가드) + 로그인 에러 1회성화 (v0.7.180)

## 작업
1. 전역 mutate 잠복버그 4파일 교정 → create 저장 즉시반영 "진짜 누락없이" 완성.
2. swr 전역 mutate import 재유입 차단 가드(hard-fail) 추가.
3. 로그인 에러를 URL(?error=)→useActionState 상태로 전환(새로고침 재출현 해소).

## 수정 파일
- calendar/DayDetailPanel.tsx · calendar/RecommendPanel.tsx · pricing/gpu/tabs/ReviewTab.tsx · pricing/gpu/tabs/QuoteRegisterTab.tsx — globalMutate→useSWRConfig().mutate
- scripts/check-design-tokens.mjs — swr 전역 mutate import 금지 룰
- login/actions.ts(signIn 반환형) · login/LoginForm.tsx(useActionState) · login/page.tsx(searchParams.error 제거)

## 완료 조건
- [x] 4파일 globalMutate 잔존 0, Context mutate 통일
- [x] 가드: 전역 mutate import 차단, 별칭 정상패턴 미오탐(자가검증)
- [x] 로그인 에러 URL 미노출 → 새로고침 1회성
- [x] tsc 0 · design:check 통과 · DC-REV 9.0
