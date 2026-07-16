# GPU 통합입력 "고정 틀(캐노니컬)" 강화 기획

- 버전: v0.7.333 (예정) · 작성일: 2026-07-16 · 상태: **기획 완료 / 구현 미착수(사용자 승인 대기)**
- 발단: 일본 소프트뱅크 AI 데이터센터 URL 투입 → 표 헤더/서비스 라벨이 모델명으로, ¥30,000이 $30,000으로 노출된 사건
- 결론: 사용자 컨셉("세상의 GPU는 유한 확정 집합 = 캐노니컬 카탈로그, 자유파싱 후 그 틀에 매핑")은 **이미 옳게 구현됨**. 문제는 틀이 **모델 정체성 1축만**, 그것도 **확정 시점에만** 적용된다는 것. 가격·통화 축과 타이밍·경로 일관성이 비어 있음.

---

## 1. 확정된 사실 (진단 요약)

| # | 사실 | 근거 |
|---|---|---|
| A | 캐노니컬 카탈로그 = `gpu_products`(121종 시드) | 마이그 025, UNIQUE(model,memory,gpu_count,vcpu,tier) |
| B | 스펙관리 탭 = 카탈로그 등록 UI (admin) | `SpecsTab` → `POST /products` |
| C | 매핑 SSOT = `resolveProductId`(모델명+장수), 실패 시 held, 자동생성 0 | `resolve-product.ts` |
| D | supplier·competitor **둘 다 확정 시점에** `resolveProductId` 통과 | `confirm-review-item.ts:185`, `competitor-import.ts:92` |
| E | **통화 미감지=USD 가정** 폴백 → ¥30,000→$30,000 (150배) | `transcription-to-items.ts:106-122`, `normalize-money.ts:78-88`(JPY throw) |
| F | **admin 직행 경로(`market/refresh`)는 가격·모델 게이트 전무** | 게이트 매트릭스, `validateCompetitorItem` 미호출 |
| G | 미리보기는 **매핑 전 날것** — 사용자가 "버그"로 오인 | 추출 단계에 resolveProductId 프리뷰 없음 |
| H | admin 직행 held는 **API 응답 1회 노출 후 증발**(영속 큐 없음) | `saveCompetitorPrices` held[] 반환 |
| I | own_target만 별도 매처 `matchProductId` 사용 (SSOT 위반) | `own-target-import.ts` |
| J | `market_prices.price_usd` DB CHECK 없음 + `market-median` 이상치 무필터 | 마이그 134, `market-median.ts:35` |

---

## 2. 문제의 재정의 — "틀"의 3가지 빈 곳

1. **차원(축)**: 틀이 **모델 정체성**만 고정. **가격·통화**엔 프레임 없음 → 모델 완벽 매핑돼도 틀린 시세가 통과.
2. **타이밍**: 틀이 **확정(commit) 시점**에만 적용 → 미리보기는 날것 → "버그 오인".
3. **경로 일관성**: 검토큐 경로는 held를 사람에게 넘기나, **admin 직행·own_target·USAI 경로는 게이트/held 처리가 제각각**.

---

## 3. 실행 계획 (우선순위)

### P0 — 데이터 안전 (즉시, 오염 차단) 🔴
목표: 잘못된 값이 콕핏/시세에 **반영되는 것**을 막는다.

- **P0-1 통화 폴백 제거**: `transcriptionToCompetitorItems`에서 통화가 USD/KRW가 아니면(JPY/EUR/CNY/미감지) **`amount`를 USD로 그대로 쓰지 말고 `price_unknown=true` 보류**. (근본: "미감지=USD 가정" 정책 삭제)
  - 확장옵션(후속): `normalize-money.ts`에 JPY/EUR/CNY 환율 소스 추가해 정식 환산. 단기는 "보류"로 안전 확보.
- **P0-2 저장 경로 가격 게이트 강제**: `saveCompetitorPrices` + `market/refresh`가 `validateCompetitorItem`(PRICE_HARD 0~1000 포함)을 통과 못한 항목은 저장 거부. (이미 존재하는 `partitionValid` 재사용 — SSOT)
- **P0-3 DB 최종 방어선**: `market_prices.price_usd`에 CHECK(0 < price ≤ 상한) 마이그레이션.

### P1 — 신뢰 타이밍 (버그 오인 제거) 🟡
목표: 사용자가 미리보기에서 **매칭/미지를 즉시** 본다.

- **P1-1 미리보기 매핑 프리뷰**: 추출/미리보기(`review/stream`) 단계에서 `resolveProductId`를 **읽기전용 프리뷰**로 태워, 각 행에 `✅ 카탈로그 매칭 / ⚠️ 미지(보류 예정) / ❔ 변형 애매` 배지 표시. (확정 로직 변경 없음, 표시만)
- **P1-2 미리보기 게이트 결과 노출**: `review/stream`이 버리던 `validateCompetitorItem`의 `ok/issues`를 배지로 표시("GPU 아님 — 제외 예정").

### P2 — 경로 일관성 (SSOT 수렴) 🟢
- **P2-1 held 종착지 통일**: admin 직행(`market/import` admin·`market/refresh`) held도 검토대기(`review_items` pending)로 영속.
- **P2-2 own_target 매처 수렴**: `matchProductId` → `resolveProductId` SSOT로 통합, held/candidates UX 일관화.
- **P2-3 market-median 이상치 방어**: PRICE_BAND 밖 값 median/min/max 제외.
- **P2-4 USAI 경로 게이트 복원**: `GPU_USAI_INGEST` 경로에도 H1 게이트 적용.

### 별도 트랙 — 입력 적합성 (제품) 🔵 (기획만, 후속 결정)
- 소프트뱅크류 **번들 서비스 요금 페이지**는 GPU 단가 스키마에 부적합. "이 URL은 GPU 가격표가 아님" 적합성 신호 + "경쟁 동향 메모" 별도 보관(시세 산정에서 격리). → 별건 기획으로 분리.

---

## 4. 완료 기준 (04-completion-criteria)

- [ ] P0-1: 일본/유럽/중국 통화 페이지 투입 시 원문 숫자가 USD로 둔갑하지 않음(보류 처리) — 회귀 테스트 추가
- [ ] P0-2: PRICE_HARD 초과($30,000 등) 항목이 `saveCompetitorPrices`·`market/refresh`에서 저장 거부됨
- [ ] P0-3: `market_prices.price_usd` CHECK 제약 존재, 위반 INSERT 실패
- [ ] P1-1: 미리보기에서 카탈로그 미지 라벨(モデルプラン 등)이 "미지/보류 예정" 배지로 명확히 구분됨
- [ ] P1-2: GPU 아님 판정 항목이 미리보기에서 "제외 예정"으로 표시
- [ ] P2-1: admin 직행 held가 검토대기 큐에 영속(증발 없음)
- [ ] P2-2: own_target도 resolveProductId 사용, held UX 동일
- [ ] P2-3: 이상 가격 1건이 market_median을 왜곡하지 않음(테스트)
- [ ] 실제 렌더 경로(기본 플래그)에서 브라우저 검증 — 정적검증만으로 완료 선언 금지
- [ ] 데이터 무손실·무오염: 기존 정상 시세 회귀 없음

## 5. 범위 제외
- 소프트뱅크 등 번들 서비스 페이지의 정식 파싱(별도 트랙)
- JPY/EUR/CNY 실시간 환율 연동(P0은 "보류"로 안전 확보, 환산은 후속)
- AI 프롬프트 튜닝 단독 대응(근본 게이트가 우선 — 프롬프트만 손대면 재발)
