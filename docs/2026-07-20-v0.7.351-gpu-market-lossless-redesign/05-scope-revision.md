# 05 — 범위 개정 (2026-07-20, 세션 재개 후)

## 배경
PC 강제종료로 중단 → 재개 시 상태 확인 결과:
- Sprint 0(T0.1~0.3) 커밋 완료(dc01c50), 마이그165 DB 적용 완료(T1.1 ✅)
- 신규 SSOT 4모듈 작성 완료(미커밋), 테스트 1069 PASS · tsc 0
- **결선(wiring) 0건** — 어떤 라우트/화면도 신규 모듈을 import하지 않음

## DC-ANA 분석으로 드러난 계획 사각지대
1. **`market/refresh`가 계획에 없었다.** 관리자가 `/pricing/gpu` 방문 시 하루 1회 자동 실행되는
   실질 주 데이터 유입 경로인데, 재설계 4모듈을 전혀 거치지 않는다.
   `CLASSIFY_PROMPT`가 AI에게 ÷720 산술을 시키는 바로 그 코드(= 재설계가 없애려던 패턴)가 여기 살아있다.
   → 02-task-breakdown.md의 T1~T3 어디에도 이 경로 교체가 없다. **최우선으로 승격.**
2. **fire-and-forget 무음 실패 위험** — 응답을 아무도 보지 않으므로 깨져도 화면에 안 뜬다.
3. **밴드 수치 변경 위험** — market-median을 성분 기반으로 바꾸면 콕핏 표시 금액이 실제로 달라진다.
4. **네이밍 충돌** — 신규 `reconciliation.ts` ↔ 기존 `reconcile.ts` 개념 중복.

## 확정 범위 (사용자 선택: [3] 범위 축소)
**이번 차수 = 추출·저장 무손실화까지. 표시(밴드/콕핏) 변경은 하지 않는다.**

포함:
- [ ] **R1** `reconciliation.ts` → `completeness-reconcile.ts` 리네임 (구 `reconcile.ts`와 개념 분리)
- [ ] **R2** `market/refresh` 재설계 경로 이식 — AI 산술 프롬프트 제거, hours.ts/normalize-money SSOT,
      obs 파이프라인 부착. 무음 실패 방지 로깅.
- [ ] **T1.3** `deterministic-table.parseHourlyProse` 결선 — 모델 근접 base_fee/usage/storage 성분 회수.
      `looksLikeGpuModel` 게이트 자체는 **유지**(月額基本料金 단독은 여전히 모델명 아님).
- [ ] **T1.4** `saveCompetitorPrices`가 `market_price_components` 저장 경로 경유(성분 있을 때만, 하위호환).
- [ ] **T4.1/T4.2(부분)** 소프트뱅크 스냅샷 골든 고정 + 신규 테스트 package.json 등록 + 실경로 검증

제외(다음 차수):
- **T3.2** 콕핏/market 밴드 flat vs usage 트랙 분리, `scenario-cost` 결선 → 표시 금액이 바뀌므로 별도 차수
- 과거 `obs_segment=NULL` 오염 행 백필 → T3.2와 함께 결정

## 실행 결과 (2026-07-20 완료)
- R1 ✅ / R2 ✅ / T1.3 ✅ / T1.4 ✅ / T4.1 ✅ — 1103 tests PASS · tsc 0 · design ✅
- 🟥 DC-SEC PASS(CRITICAL·HIGH·MEDIUM 0) / 🟥 DC-REV 84 / 🟥 DC-QA FAIL→지적 전량 수정 후 해소

### 검증 중 발견·수정한 실제 결함 (계획에 없던 것)
1. **storage 100배 과대계상** — `1,000円/100GB`를 amount=1000·unit=per_gb로 저장 → 1GB 단가로 정규화(10).
2. **base_fee 주기 소실** — `月額基本料金`을 per_account로 뭉개 주기 소실 → `month`로 구조화.
3. **정액요금 年↔月 12배 오차** — `scenario-cost`가 base_fee의 year/day 단위를 정규화하지 않음.
   추가로 시간비(8760/720=12.167) 환산은 정액요금에 +1.4% 오차 → `MONTHS_PER_PERIOD`(달력 SSOT) 신설.
4. **테스트가 버그를 정답으로 박제** — 위 1·2를 기대값으로 단언하고 있어 1087 전량 그린이었다.
   → 초록불이 정확성을 보증하지 못함. 골든 픽스처를 먼저 박고 나서야 드러났다.
5. **`price-signal.test.ts` 미등록** — package.json test 목록에 없어 9개 테스트가 여태 실행조차 안 됨.

## 미해결 — 다음 차수 필수 (은폐 금지)
- [ ] **`completeness-reconcile.ts` 미결선** — 리네임만 했고 어떤 라우트도 호출하지 않는다.
      즉 "미커버 금액 = 자동확정 차단" 효과는 **아직 발생하지 않는다**. 파일 주석에 경고 명시함.
- [ ] **성분만 있고 대표가 없는 항목은 저장 불가** — `market_prices.price_usd`가 **NOT NULL + CHECK(>0)**.
      `saveCompetitorPrices`의 `!item.price_usd → continue`가 성분 경로를 원천 차단한다.
      해소하려면 컬럼 nullable 마이그레이션이 필요(스키마 변경 → 별도 차수).
- [ ] **저장 경로 런타임 테스트 0건** — `competitor-import.test.ts`는 정적 소스 스캔이라
      `.select('id').single()` 체이닝·`obsErr continue` 같은 DB 호출 형태 오류를 잡지 못한다.
      인메모리 db 스텁으로 `saveCompetitorPrices`를 실제 호출하는 통합 테스트 필요.
- [ ] **market/refresh 실경로 스모크 미실시** — Gemini 프롬프트 스키마를 전면 교체했으나
      AI 호출을 모킹한 통합 테스트가 없다. 실사이트 1회 수동 검증 필요(T4.2 잔여).
- [ ] `sanitizeMarketRefreshComponents`가 kind별 unit 유효조합 미검증(storage에 hour 등 통과).
- [ ] T3.2 밴드/콕핏 표시 + 과거 `obs_segment=NULL` 오염행 백필 결정.

## 근거
저장이 무손실이 되면 데이터는 그때부터 온전히 쌓인다. 표시 변경은 이후 언제든 가능하다.
반대로 표시부터 바꾸면 밴드 수치가 흔들리는데 하부 데이터는 여전히 손실 상태라 검증 기준이 사라진다.
데이터 정합성이 표시보다 먼저다.
