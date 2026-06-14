# CRITICAL 일괄 보수 기획서 — GPU 가격관리 치명 결함

작성 2026-06-15 · 상태 기획(미구현) · 근거 전수 감사 + 실 DB pg_policies 검증
원칙: **치명적인 것만, 한 번에(1 ralph 루프), 계산식(buildCatalog) 불변 R1**

> 대상 = 감사 CRITICAL 9건. HIGH 이하는 본 작업 제외(후속). 전부 한 작업으로 묶어 RLS→인증→SSRF→정합성 순서로 적용.

---

## C1. RLS 베이스라인 재작성 — anon 노출 + 원가 변조 (최우선)

**문제(실 DB 확정):** `supply_quotes·suppliers·gpu_products·direct_prices·pricing_settings·gpu_audit_logs` 가 `SELECT USING(true) TO public` → anon 키로 전 원가·판매가·마진·감사 읽힘. `supply_quotes`는 `UPDATE USING(true) TO authenticated` → 로그인 누구나 원가 변조. `review_items`·`pool_stock`·`availability`는 `ALL TO authenticated`.

**해결:** 마이그 **092_rls_hardening.sql** (롤백 포함) — `036_partner_tiers` 패턴을 SSOT로 전 민감테이블 재작성.
- 모든 민감 테이블: 기존 `all: read (USING true)`·`auth: write/update` 정책 **DROP**.
- 신규 정책: `SELECT TO authenticated USING (is_member())` — 여기서 `is_member()` = `EXISTS(profiles where id=auth.uid() and role in ('admin','member'))`. **api_user·anon 차단.**
  - 더 민감한 것(원가·감사): admin-only 권장 → `is_admin()`. (단, 내부 화면이 member 읽기 필요한지 확인: 통합표는 admin 게이트라 admin-only 무방. cockpit/원가도 admin 전용.)
- 쓰기: `ALL TO public USING (auth.role()='service_role')` 만 유지(서버 라우트가 service_role로 씀). authenticated INSERT/UPDATE 정책 전부 DROP.
- `is_member()`/`is_admin()` SQL 함수를 SSOT로 신설(SECURITY DEFINER, profiles 조회).
- 적용 후 **재검증**: anon 키로 REST 직접 호출 시 401/빈, member로 원가 UPDATE 시 거부.

**대상 테이블 전수:** supply_quotes, suppliers, gpu_products, direct_prices, pricing_settings, gpu_audit_logs, review_items, review_iterations, pool_stock(direct_pool_stock), availability(inquiries·availability_responses), price_range_learned, gcube_price_checks, supplier_model_tier, market_prices, competitor_product_mapping, competitors, gpu_specs, partner_tiers — **USING(true)/FOR ALL authenticated 전부 제거.**

> 마이그 090(market_rls)·091(gcube_reflected) 미적용분도 이 작업에서 함께 적용.

---

## C2. 인증 없는 GET 전수 — requireAdminApi

**문제:** cockpit·inventory·market·quotes·quotes/pending·suppliers·audit(GET)·review(GET)·review/[id]/iterations·products·gcube-check·partner-tiers(GET) 가 인증/권한 게이트 없음 → 원가·전략가·PII 노출(RLS가 막아도 앱 레이어 2중 방어 필요).

**해결:** 각 GET 라우트 진입부에 `requireAdminApi()`(또는 member 허용 화면은 `requireMemberApi` 신설) 추가. 화면 권한과 일치:
- admin 전용(원가·전략가 포함): cockpit, inventory, market, quotes, quotes/pending, audit, review, review/[id]/iterations, gcube-check, partner-tiers, suppliers.
- member 읽기 허용(있다면): products·competitors는 member 허용 여부 확인 후 `requireMemberApi`.
- 누락 라우트 0 확인: `grep -L requireAdminApi app/api/pricing/gpu/**/route.ts` 로 전수 점검.

---

## C3. review_items 등 authenticated FOR ALL 분리

C1 마이그에 포함: `review_items`·`review_iterations`·`pool_stock`·`availability`의 `FOR ALL TO authenticated` → `SELECT TO authenticated(is_member)` + 쓰기 service_role 전용. (서버 라우트는 이미 service_role/admin 게이트 → 영향 없음.)

---

## C4. quotes/[id]/reject 관리자 게이트

**문제:** reject 라우트에 `requireAdminApi` 없음 → 임의 견적 reject(DoS). 또한 audit를 user-client로 직접 INSERT(실패 가능).
**해결:** 진입부 `requireAdminApi()` + audit를 `recordGpuAudit`(service_role) SSOT 경유로 교체.

---

## C5. SSRF 차단 — safe-fetch SSOT

**문제:** `review/route.ts fetchUrlText`·`market/refresh` 가 DB의 competitor_url/pricing_url을 스킴·사설망 검증 없이 fetch(IMDS 169.254.169.254 등 탈취·OOM).
**해결:** `lib/security/safe-fetch.ts` 신설:
- 스킴 화이트리스트 `http(s):` 만. `javascript:/file:/gopher:/data:` 거부.
- 호스트 DNS resolve 후 사설/loopback/link-local/메타데이터 CIDR(10/8,172.16/12,192.168/16,127/8,169.254/16,::1) 차단.
- `redirect:'manual'` + 홉마다 재검증. `Content-Length`/스트리밍 누적 상한(예: 2MB). 타임아웃.
- `fetchUrlText`·`market/refresh` 모든 외부 fetch를 이걸로 교체. URL 저장 라우트(competitors/mappings POST·PATCH)는 저장 시 스킴 검증.

---

## C6. DetailPanel key 버그 — 다른 GPU에 전략가 오저장

**문제:** `UnifiedTable.tsx`의 `<DetailPanel row={selectedRow} .../>`에 key 없음 → 행 전환 시 내부 입력 state(전략가 입력값 등) 잔류 → **다른 제품에 잘못 저장**(실데이터 오염).
**해결:** `<DetailPanel key={selectedRow?.id ?? 'empty'} ... />`. (1줄. 동시에 costEditNote/탭 상태도 행 단위로 리셋됨.)

---

## C7. public API를 buildCatalog SSOT로 통일

**문제:** `public/v1/products·[id]·quote·market` 가 `v_lowest_quotes` 자체계산(실견적우선·1장당전파·채택우선·공시가폴백 누락) → **외부 파트너가 받는 가격 ≠ 내부 화면 가격.**
**해결:** 네 라우트를 `getGpuCatalog(buildCatalog)` 결과에서 필요한 필드만 매핑하도록 교체(내부 products/cockpit과 동일 소스). `v_lowest_quotes` 직접 사용 폐기. 외부 노출 필드(원가 제외, 판매가/전략가만)는 화이트리스트로 제한.
- 검증: 동일 product를 내부 가격표 vs public API로 조회 → 값 일치.

---

## C8. audit action_type 누락 등록

**문제:** `quote_selected/deselected`가 gpu_audit_logs CHECK에 없음 → 견적 채택 시 audit INSERT 500.
**해결:** C1 마이그(092)에 CHECK 확장 — 기존 값 전부 보존 + `quote_selected`,`quote_deselected` 추가.

---

## 한 번에 적용 — 작업 묶음 (1 ralph 루프)

| 순서 | 작업 | 산출 |
|------|------|------|
| 1 | 마이그 092 (RLS 재작성 + is_member/is_admin 함수 + audit CHECK + 090/091 병합) → **dev 적용** | supabase/migrations/092 |
| 2 | requireAdminApi/requireMemberApi 누락 GET 전수 추가 | app/api/pricing/gpu/** |
| 3 | safe-fetch SSOT 신설 + SSRF 지점 교체 | lib/security/safe-fetch.ts |
| 4 | reject 게이트 + audit SSOT | quotes/[id]/reject |
| 5 | DetailPanel key 1줄 | UnifiedTable.tsx |
| 6 | public/v1 4라우트 buildCatalog 통일 | app/api/public/v1/** |

## 완료 검증 (필수)
- **실 DB 재검증**: pg_policies로 USING(true)·FOR ALL authenticated 0건 확인. anon 키 REST 직접 호출 → 차단. member 토큰으로 supply_quotes UPDATE → 거부.
- 🟥 DC-SEC 재감사: CRITICAL 0.
- 골든셋 무회귀(buildCatalog 불변) + 통합표/콕핏 정상(브라우저).
- public API 가격 = 내부 가격 일치 테스트.

## 제약
- 계산식(pricing.ts/buildCatalog) 불변(R1) — public은 그 결과를 "쓰기만". 디자인 토큰/공용컴포넌트. 커밋만(push 금지). 마이그는 dev 적용(관리자 설정 DB 연결정보 사용).

> 본 문서는 **기획·보고만**. 실제 구현은 별도 지시(예: /ceo-ralph 본 문서 전량) 시.

---

## [검증] "이렇게 구축하면 문제 없나" — 실제 코드 대조 (구현 전 회귀 점검)

각 라우트가 **어느 Supabase 클라이언트로 데이터를 읽는지** 전수 확인. RLS 조이기는 **user-scoped(`createClient`, 쿠키) 읽기에만 영향**, `createAdminClient`(service_role)는 RLS를 우회하므로 무영향.

### ✅ 안전 확정 (안 깨짐)
- **public/v1 전 라우트 = `createAdminClient`(service_role).** → **RLS 강화가 외부 API를 깨지 않는다.** (products·[id]·quote·market·suppliers·settings·inventory·fx 모두 admin client 확인). 외부 노출 차단은 RLS가 아니라 각 라우트의 **API키 인증**이 담당 → RLS 강화의 목적(=anon 브라우저키로 REST 직타 차단)은 anon 정책 제거만으로 달성, 외부 정식 호출은 무영향.
- **RLS 재귀 위험 없음.** `is_member()/is_admin()`는 `036/009/037`이 이미 쓰는 `EXISTS(SELECT 1 FROM profiles ...)` 패턴(타 테이블 정책의 profiles 서브쿼리는 안전). 003의 재귀는 profiles **자기 정책**의 PostgREST JOIN 한정 → 해당 없음. SECURITY DEFINER로 더 안전.
- **DetailPanel key·public SSOT 교체**: `getGpuCatalog(db)`가 임의 client를 인자로 받음(시그니처 확인) → public에서 admin client 그대로 주입 가능. 회귀 위험 낮음(응답 필드 매핑만 정확히).

### ⚠️ 조건부 함정 — RLS "레벨"을 잘못 잡으면 내부 화면이 조용히 빈다 (가장 중요)
실측: **내부 GET 라우트는 민감 테이블을 user-scoped 클라이언트로 읽는다.**
- `cockpit`(createClient→`getGpuCatalog(db)`·`supply_quotes`·`market_prices`·`gpu_audit_logs`), `products GET`(`supply_quotes`), `suppliers GET`(`supply_quotes`), `quotes GET`(`supply_quotes`), `inventory`·`market`·`quotes/pending` — **전부 쿠키 클라이언트로 읽음 = RLS 적용 대상.**
- 지금 동작하는 이유 = RLS가 `USING(true)`(개방)라서. **여기서 RLS를 `is_admin()`(관리자 전용)으로 조이면 → member 로그인 사용자가 이 화면을 열면 RLS가 행을 걸러 빈 데이터**(403이 아니라 "데이터 없음"으로 오인 = UX 함정).

**→ 결론(반드시 반영):**
1. **읽기 RLS는 `is_admin()`이 아니라 `is_member()`(admin+member, anon·api_user 제외)로 한다.** 그래야 미들웨어 인증 통과한 직원이 내부 화면을 정상 조회. **관리자 전용 강제는 RLS가 아니라 라우트의 `requireAdminApi`(C2)에서** 건다. (RLS=데이터 차단막 / 게이트=화면 권한 — 역할 분리)
2. **절대 `TO authenticated USING(true)`로 열지 말 것.** **api_user도 `authenticated`** 라서 그렇게 열면 외부 API 사용자에게 원가가 노출(현 노출과 동급). 반드시 `is_member()` 술어로.
3. **RLS 마이그(C1)와 인증 게이트(C2)는 반드시 같은 배치에서.** RLS만 먼저 조이고 게이트를 늦추면 그 사이 내부 화면이 빈다. 한 작업(1 ralph 루프)으로 묶는 본 기획의 전제와 일치 → **분할 배포 금지**.

### 최종 판정
- 기획대로 하되 **위 1·2·3을 지키면 회귀 없음.** 외부 API(service_role)는 무영향, 내부 화면은 `is_member` 레벨로 정상.
- 잘못 가는 길(=`is_admin` RLS 또는 bare `authenticated`)은 실제 코드상 **확정적으로** 내부 화면 블랭크 또는 api_user 노출을 부른다 → 본 절이 그 함정을 미리 닫음.
- 미검증 잔여: 외부 API가 **이미** `unit_price_usd`(공급 단가)를 노출 중(C7 교체와 무관한 선재 노출) — 외부 원가 노출 정책 여부는 별도 결정 사항(HIGH, 본 CRITICAL 배치 밖).
