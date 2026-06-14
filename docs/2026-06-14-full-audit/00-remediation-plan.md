# GPU 가격관리 전수 감사 — 결함 인벤토리 & 완전 보수 로드맵

감사 2026-06-14 · 🟥 DC-SEC · 🟥 DC-QA · 🟦 DC-ANA×2 · 상태 기획(미구현)
판정: **헛점 0 미달.** 보안 CRITICAL 11 / HIGH 41, 정합성·CRUD·엣지 다수.

> 결론 먼저: 지금은 "표시 다듬기"가 아니라 **보안(RLS)·정합성(SSOT)·검증·감사** 전면 보강 단계. 아래 P0→P4 순서로 가야 헛점이 닫힘.

---

## P0 — CRITICAL (운영 데이터 직접 노출/오염 · 즉시)

| # | 결함 | 위치 | 영향 |
|---|------|------|------|
| 0-1 | **RLS 베이스라인 전면 개방** — `supply_quotes·direct_prices·pricing_settings·suppliers·gpu_products·gpu_audit_logs` 가 `USING(true)`(anon 포함) | 024/026 마이그 | **anon 키로 전 공급사 원가·우리 판매가·마진·전략가 누출**(B2B 치명) |
| 0-2 | **감사로그 위조** — `gpu_audit_logs` authenticated INSERT `WITH CHECK(true)` | 026 | 로그인 누구나 actor/이력 위조 → 부인방지 붕괴 |
| 0-3 | **review_items/pool_stock/availability** `FOR ALL authenticated` | 029/030/031 | api_user·member가 검토큐 직접 INSERT→견적 오염 |
| 0-4 | **인증 없는 GET** — cockpit·inventory·market·quotes·quotes/pending·suppliers·audit·review·products·gcube-check | 각 route GET | 원가·전략가·PII member/anon 노출 |
| 0-5 | **관리자 게이트 없는 상태전이** — `quotes/[id]/reject` | reject/route.ts | 임의 견적 reject → 가격책정 마비(DoS) |
| 0-6 | **SSRF** — `market/refresh`·`review` 크롤이 임의 URL fetch(스킴/사설망/IMDS 미차단) | review/route.ts:167, market/refresh:50 | 내부망·메타데이터 탈취·OOM |
| 0-7 | **DetailPanel key 누락 → 잘못된 제품에 전략가 저장** | UnifiedTable.tsx:225 (`<DetailPanel>` key 없음) | 행 전환 시 입력 잔류 → **다른 GPU에 전략가 오저장**(실데이터 오염) |
| 0-8 | **public API가 SSOT 이탈** — `public/v1/products·[id]·quote·market`가 `v_lowest_quotes` 자체계산(실견적우선·전파·채택·공시가폴백 전부 누락) | public/v1/** | **외부 파트너 견적가 ≠ 내부 화면가** (정합성 핵심 붕괴) |
| 0-9 | **audit action_type 미등록** — `quote_selected/deselected`가 CHECK에 없음 | quotes/[id]/select | 견적 채택 시 audit INSERT 500 가능 |

---

## P1 — HIGH (정합성·감사·검증)

**입력 검증 SSOT 부재 (전 쓰기 라우트):**
- 숫자 상한 없음(전략가/단가/마진/수량/가격 → `Number.MAX` 저장 가능), `!isNaN`→`Infinity` 통과(`isFinite`로), UUID 미검증, URL 스킴 화이트리스트 부재(저장형 XSS·SSRF), ILIKE `%` 미escape(다른 공급사 오귀속). → `lib/security/{validators,safe-fetch,respond-error}.ts` SSOT 신설 후 전수 적용.

**감사 부재·오용:**
- 공급사 C/U/D **audit 전무**. 공급사/경쟁사 변경이 `market_price_updated`로 **의미 오용**. 매핑 POST·specs 변경 audit 없음.

**캐시/갱신 누락 (한 곳 수정→다 반영 깨짐):**
- ReviewTab 확정 후 cockpit SWR 미갱신 · market refresh 후 mutateGpu 누락 · quotes reject 후 revalidate 없음.

**SSOT 중복:**
- tier 라벨이 `tierName`(SSOT) 외 catalog/page.tsx·PriceTableTab.tsx에 **3중 인라인**. cockpit `candidate_price_krw`가 buildCatalog effective와 다른 원가 사용.

**에러 UI 누락:**
- DetailPanel(공급원가·이력)·BulkReflectPanel SWR `error` 미처리 → **에러를 "데이터 없음"으로 오인**(미반영 0건처럼 보임).

**기타 HIGH:** 마이그 090(market RLS)·091 미적용 · 공급사 소프트삭제 부재(경쟁사와 패리티) · AI 호출 비용/QPS 게이트 부재(토큰 폭주) · `usd_krw=0` 시 Infinity 누출 · `unit_price_usd>0` DB 제약 없음 · 에러메시지 raw 노출.

---

## P2 — MEDIUM (기능 완비)

- **역연산 부재**: gcube 반영 취소 / 견적 확정 되돌리기 / 검토 반려 복구 / 경쟁사·공급사 삭제 복구.
- **일괄 부재**: 시장가·견적·매핑·검토 일괄.
- **가드 부재**: 경쟁사 soft delete 시 매핑 고아 / 제품 `?force=true` 우회.
- **단건 GET API 부재**: competitors/[id]·products/[id] GET.
- **테스트 사각**: `cockpit-to-unified`·`inventory-to-unified`·`gcube-reflected` 단위테스트 **0**. 골든셋이 list 전파·direct strategic 분기 미커버.
- 통화 토글 콕핏 미적용 · review GET limit 50 하드코딩(오래된 항목 조회 불가).

---

## P3 — LOW (성능·위생)

- **서버 페이지네이션 전무** — 공급사·경쟁사·제품(351행)·견적 전부 전체 로드(규모 증가 시 위험).
- public CORS `*` · 로깅 위생(raw err·키 노출 가능) · 색상 상수 라우트별 중복 · api_keys 스코프 부재(어떤 키든 settings/products 전권).

---

## "표 명확·근거·CRUD·일괄·SSOT" 5대 기준 대비 (사용자 원요구)

| 기준 | 현 상태 | 닫는 항목 |
|------|---------|-----------|
| 표 명확 | 🟡 가격표에 원가 컬럼 없음·표본수 없음 | 보기 컬럼 보강 |
| 근거 명확 | 🟡 통합표 목록 셀에 출처 미표시(상세만) | `source` 셀을 프리셋에 |
| CRUD 명확 | 🟠 공급사 하드삭제·audit부재, 매핑 하드삭제, 단건GET 일부 부재, 역연산 부재 | P1·P2 감사·소프트삭제·역연산 |
| 일괄 명확 | 🟡 시장가·견적·매핑·검토 일괄 없음 | P2 일괄 |
| SSOT(하나 수정→다 반영) | 🟠 **public API 자체계산·캐시갱신 누락·tier 3중·cockpit 원가 재계산** | P0-8·P1 캐시·SSOT |

---

## 보수 로드맵 (순서가 중요 — 의존성順)

1. **P0-보안 먼저** — RLS 베이스라인 재작성(`036_partner_tiers` 패턴 SSOT) + 누락 `requireAdminApi` 전수 + `safe-fetch`(SSRF) + DetailPanel `key` 버그. **이게 안 닫히면 나머지는 무의미.**
2. **P0-정합성** — public/v1 전부 `getGpuCatalog` 경유로 통일(자체계산 폐기) + audit CHECK에 `quote_selected/deselected` 추가.
3. **P1-검증·감사 SSOT** — validators/respond-error SSOT 신설→전 라우트 적용, 공급사/경쟁사/매핑/specs audit 정상화, 캐시 갱신(mutateGpu) 누락 보강, tier 라벨 단일화, 에러 UI 3종.
4. **P2-CRUD 완비** — 소프트삭제 패리티·역연산(취소/복구)·일괄(시장가·견적·매핑)·연쇄 가드·단건 GET·핵심 단위테스트.
5. **P3-성능·위생** — 서버 페이지네이션, 로깅/CORS/스코프.

---

## 권장 진행 방식
헛점 0 = 위 P0~P3 **전량**. 단번에 다 하면 회귀 위험이 크므로 **P0(보안+정합성 핵심)부터 한 단계씩**, 각 단계 후 🟥 DC-SEC/DC-REV + 골든셋 + 브라우저 검증. /ceo-ralph로 P0부터 자율 보수 권장.

> 본 문서는 **감사·기획만**. 구현은 단계 승인 후 진행.

---

## [실 DB 검증 — 마지막 확인] RLS 노출은 추측이 아니라 사실 (live pg_policies)

`pg_policies` 직접 조회 결과(운영 DB, 마이그 089까지 적용분):

| 테이블 | SELECT 정책 | 추가 위험 |
|--------|-------------|-----------|
| supply_quotes | `USING(true) TO public(anon포함)` | **+ `UPDATE USING(true) TO authenticated`** = 로그인 누구나 **원가 수정 가능** |
| suppliers | `USING(true) TO public` + `INSERT TO authenticated` | anon 읽기 + 인증 INSERT |
| gpu_products | `USING(true) TO public` | anon이 전략가·반영가 읽기 |
| direct_prices | `USING(true) TO public` | anon이 우리 판매가 읽기 |
| pricing_settings | `USING(true) TO public` | anon이 마진 정책 읽기 |
| gpu_audit_logs | `USING(true) TO public` (쓰기는 service_role) | anon이 감사 이력 읽기 |
| review_items | `ALL TO authenticated` | api_user·member 검토큐 직접 RW |
| competitors·market_prices | `SELECT TO authenticated` | member 읽기 |

**확정 사실**: anon 키(브라우저 번들 공개)로 Supabase REST(`/rest/v1/...`)를 직접 치면 **전 공급사 원가·우리 판매가·마진·감사가 다 읽힘**(Next.js 미들웨어는 REST를 못 막음). 게다가 **로그인 사용자는 supply_quotes 원가를 직접 수정** 가능. → 보고서 0-1보다 **한 단계 더 심각**(read 노출 + write 변조).

## 재정리 — 이건 "단계 분할 릴리즈"가 아니라 **한 작업**
P0~P3는 따로 내보내는 게 아니라 **한 번의 보수 작업 안의 적용 순서**(RLS→public SSOT→검증/감사→CRUD/일괄/역연산→성능). 한 방에 다 구현하되, RLS·DetailPanel key·public SSOT를 먼저 손대야 나머지가 헛되지 않음. 분량은 1 스프린트(ralph 1 루프)로 충분.

## 감사 완전성
커버 축: 보안(RLS 실DB검증·엔드포인트·SSRF·인젝션·검증) · 정합성/SSOT · CRUD/권한/감사/소프트삭제/역연산/일괄 · 엣지/에러/실패/테스트사각 · 마이그정합. → **데이터 정합성·보안 축은 빠짐없이 감사됨.** 미감사 잔여는 접근성/i18n/반응형 등 UI 위생(데이터 무결성과 무관) 뿐.
