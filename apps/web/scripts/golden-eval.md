# 자가검증 하네스 — 골든셋 eval + 게이트 차단 (H3/H1 검증)

데이터 정합성·신뢰도를 **수치로 입증**하는 회귀 테스트. 인증이 필요하므로 로그인된 브라우저 콘솔(또는 Playwright)에서 실행.

## 1) 게이트 차단(결정적) — 단위테스트
```bash
cd apps/web && npx vitest run lib/gpu/validate.test.ts lib/gpu/dedup.test.ts
# 기대: validate 12/12, dedup 7/7 PASS
```

## 2) 골든셋 추출 정확도 + 라이브 게이트 차단 — 로그인 브라우저 콘솔에서
`lib/gpu/golden-set.ts`의 GOLDEN 케이스를 사용. 아래를 콘솔에 붙여 실행:

```js
// good: 추출이 정답과 일치 / bad: commit·import가 422·400으로 차단
// (구현: docs의 golden-eval 절차 참고 — runStream으로 /review/stream 호출, bad는 /commit·/market/import 호출)
```

## 합격 기준 (릴리즈 게이트)
- good 추출 일치율 100% (가격 허용오차 ±0.06)
- bad 게이트 차단율 100% (enum·범위·이상치 위반은 반드시 차단)

## 최근 결과 (2026-06-05, v0.6.82)
- 골든 good 3/3 (H100 월→시간환산 $3.65, 배치 3모델, NAVER $4.38)
- 게이트 bad 5/5 (모델명없음·음수가·tier위반·pricing_model위반·가격없음 전부 차단)
