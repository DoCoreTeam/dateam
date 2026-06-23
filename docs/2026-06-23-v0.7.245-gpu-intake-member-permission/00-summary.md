# v0.7.245 — GPU 통합입력 member 권한 정합화 (제출=member / 확정=admin)

> 상태: **기획 완료 · 미구현** (사용자 지시 "절대 구현하지마")
> 작성: 2026-06-23 · 규모: MEDIUM · 결정: 권장안(제출까지 member 허용, 확정은 admin)

---

## 1. 문제 (근본 원인)

GPU 통합입력 탭(`/pricing/gpu?tab=intake`)은 **member에게 노출**되지만, 탭 안의
**모든 동작 API가 `requireAdminApi`(admin 전용)** 라 member는 무엇을 눌러도
`403 "권한이 없습니다 (관리자 전용)"`(출처: `lib/auth/requireAdminApi.ts:24`)를 받는다.

- 엑셀/CSV 첨부 → `/market/catalog`(admin) → 403 ← **사용자가 본 화면**
- 텍스트/이미지/PDF 분석 → `/review/stream`(admin) → 동일하게 403
- 저장 → `/review/commit`(admin) → 동일

### 왜 이렇게 됐나
`supabase/migrations/092_rls_hardening.sql`에서 **"읽기=member, 쓰기/변이=admin"**
규칙을 일괄 적용. 통합입력은 "쓰기" 기능이라 admin 게이트가 붙었으나,
**탭 노출은 member로 열린 채** 남아 모순 발생. 의도된 기능 제한이 아니라
**규칙 일괄적용의 부작용**.

### 구조적 사실 (보안)
대상 테이블(`review_items`·`market_prices`·`competitors` 등)은 092에서
authenticated 쓰기 RLS 정책이 **제거**됨 → 서버가 **service_role(admin client)** 로만 기록.
따라서 **앱 레이어 `requireAdminApi`가 유일한 접근 통제**다. 게이트를 바꾸면
그만큼 호출 권한이 바뀐다(서버 쓰기 자체는 service_role이라 그대로 동작).

---

## 2. 결정 (사용자 선택)

**제출까지 member 허용 · 확정/반영은 admin 유지.**
시스템은 이미 `제출 → 검토대기(review_items) → admin 확정` 2단계라,
**검토대기 적재까지만 member에 열고 승인 게이트는 보존**한다. 가격 실데이터
직접 변조는 차단된다.

---

## 3. 변경안 (구현 시 — 게이트 1줄 교체)

### member 허용으로 전환 (`requireAdminApi` → `requireMemberApi`)
| 라우트 | 동작 | 쓰기 대상 | 비고 |
|---|---|---|---|
| `app/api/pricing/gpu/review/stream/route.ts:38` | 추출/미리보기 | **없음** | DB 무영향, 가장 안전 |
| `app/api/pricing/gpu/review/commit/route.ts:18` | 제출(저장) | `review_items`(검토대기) | service_role로 씀 → 정상 |
| `app/api/pricing/gpu/market/catalog/route.ts:147` | 엑셀/CSV 흡수 | `review_items`(검토대기) | service_role로 씀 → 정상 |

### admin 유지 (변경 없음 — 확정/반영/마스터)
- `review/commit`은 위에서 member로 이동하므로, **확정 경로**는 아래로 한정:
  `market/import`(시장 라이브 반영), `review/bulk`, `review/[id]`,
  `review/[id]/recheck`, `quotes/[id]/confirm|reject|select|reanalyze`
- 마스터 CRUD 전부 유지: `suppliers*`·`competitors*`·`specs*`·`products*`·
  `direct-prices*`·`partner-tiers*`·`pool-stock*` 등

> **호환성**: `requireMemberApi`는 `{ user:{ id, email, role }, error }` 반환 —
> `requireAdminApi`의 `{ user:{ id, email }, error }`의 상위호환. 호출부의
> `auth.user.email`/`auth.user.id` 사용은 그대로 동작(시그니처 변경 불요).

> **프론트**: `QuoteRegisterTab.tsx`에 isAdmin 게이팅 없음 → FE 변경 불필요.
> 게이트 교체만으로 member 화면에서 403이 사라지고 제출이 정상 동작.

---

## 4. 영향 범위 / 회귀 리스크

- 변경 파일: **API 라우트 3개**(각 1줄 import+호출). FE·DB·마이그레이션 변경 없음.
- admin 동작: 전부 그대로(member는 admin의 상위호환 통과).
- 데이터 정합: 제출은 **검토대기 staging**에만 적재 → admin 승인 전 라이브 미반영.
- RLS: 변경 없음(서버 service_role 쓰기 유지).
- 감사: `gpu_audit_logs`에 제출자(member) email 기록됨 → 추적성 유지.

---

## 5. 완료 기준 (구현 단계에서 검증)

- [ ] member 계정으로 통합입력: 텍스트 분석 → 미리보기 표시(403 없음)
- [ ] member 계정으로 엑셀/CSV 첨부 → 검토대기 적재 성공(403 없음)
- [ ] member 계정으로 "저장" → `review_items`에 검토대기로 적재
- [ ] member 계정으로 `market/import`(확정/반영) 시도 → **여전히 403**(승인 게이트 보존)
- [ ] member 계정으로 suppliers/competitors/specs 직접 CRUD 시도 → **여전히 403**
- [ ] admin 계정: 기존 흐름 전부 무회귀
- [ ] `tsc --noEmit` 0 · `pnpm design:check` 통과
- [ ] Playwright 실측: member 제출 → 검토대기 적재 → admin 승인까지 E2E
