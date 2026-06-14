# gcube 공시가 관리 워크플로 — 기획서

작성: 2026-06-14 · 상태: 기획(미구현) · 원칙: **기존 자산 최대 재사용**

---

## 0. 한 줄 요약

> 추천 판매가(공급원가 유래) → **반영**(전략가=목표 공시가 확정 + 이력) → 실제 gcube 홈페이지 반영 여부 추적(미반영/반영됨) → 일괄 처리.
> **이 흐름의 70%는 이미 구현됨**(콕핏 탭). 통합표로 끌어오고, "반영 완료 추적"·"일괄"만 신규.

---

## 1. 먼저 — gcube "가격" 2개를 구분해야 함 (혼동 주의)

| 이름 | 정체 | 소스 | 비고 |
|------|------|------|------|
| **gcube 공시가(수동)** | 우리가 입력한 게시가 | `supply_quotes.price_type='list'` | 콕핏 `gcube_site_price_krw` |
| **gcube 파싱가(자동)** | gcube.ai에서 매일 긁은 실제 게시가 | `gcube_price_checks` 테이블 + `gpu_products.gcube_last_*` | `scripts/gcube-price-check.mjs`(매일 00:00 KST, GitHub Actions) |
| **전략가(우리 판매가)** | 우리 판매가의 '진실' | `gpu_products.strategic_price_krw` | 추천가를 '지정'하면 여기로 승격 |
| **추천 판매가(candidate)** | 공급원가 × (1+마진) | 콕핏 계산(메모리) | 클릭 시 전략가로 승격 가능 |

→ 사용자의 "홈페이지 가격"은 보통 **파싱가(자동, 실제 사이트값)**, "반영"은 **전략가 확정 = 목표가 설정**을 뜻함.

---

## 2. 이미 구현된 자산 (재사용 — 새로 만들지 말 것)

| 기능 | 상태 | 위치 |
|------|------|------|
| 전략가 저장/설정(단건) | ✅ 있음 | `gpu_products.strategic_price_krw` · `PATCH /api/pricing/gpu/strategic-price` |
| 추천가 계산 + '지정' 1클릭(→전략가) | ✅ 있음 | `cockpit/route.ts`(candidate) · `CandidateCell.tsx promote()` |
| gcube 자동 파싱 + 저장 + 스케줄 | ✅ 있음 | `gcube-price-check.mjs` · `gcube_price_checks` · GitHub Actions |
| 동기화 갭 뱃지(match/mismatch/not_found) | ✅ 있음 | `GcubeSyncBadge.tsx` · `GET /api/pricing/gpu/gcube-check` |
| 전략가 변경 이력(최근 5건) | ✅ 있음 | `gpu_audit_logs(strategic_price_set)` · cockpit `strategic_history` · `StrategicHistoryDrawer` |
| 통합표 변동이력 탭(전략가설정 포함) | ✅ 있음 | `unified/DetailPanel.tsx` · `audit-labels(strategic_price_set='전략가 설정')` |
| 추천가 공급원가 출처(전파/실견적·공급사) | ✅ 있음(직전 작업) | 통합표 상세 공급원가 탭 |

## 3. 부분/없는 것 (이번 기획의 신규 범위)

| 기능 | 상태 | 신규 설계 |
|------|------|-----------|
| 추천가·gcube 파싱가·동기화상태를 **통합표 상세**에 함께 표시 | ❌ 통합표엔 없음(콕핏에만) | **A. 통합표 상세 '가격 결정' 섹션**으로 끌어오기 |
| 전략가 설정 시 **이유(reason)** 입력 UI | ⚠️ API만 있고 UI 없음 | A 섹션에 reason 입력 추가 |
| **"홈페이지 반영 완료" 추적** | ❌ 전혀 없음 | **B. `gcube_reflected_*` 컬럼 + 반영 버튼 + audit** |
| **일괄 반영 리스트** | ❌ 없음 | **C. 미반영 모아보기 + 일괄 전략가 확정** |
| gcube 파싱 이력 시계열 조회 UI | ⚠️ 데이터만 쌓임 | A 섹션에 파싱 이력 표시(선택) |

---

## 4. 설계 — 워크플로

```
[1] 추천 판매가 확인        (이미: candidate = 공급원가×마진, 출처 공급사 표시)
        │  "판매가 추천" 클릭 → 산정 근거(전파/실견적·공급사·마진) 펼침 + 값 조정 가능
        ▼
[2] 반영(전략가 확정)        (이미: PATCH /strategic-price + 이력)  ← reason 입력 추가
        │  = "이 가격을 gcube 홈페이지 목표가로 정함"
        ▼
[3] 동기화 갭 표시           (이미: GcubeSyncBadge — 파싱가 vs 전략가)
        │  전략가 ≠ 실제 파싱가 → "미반영"(mismatch) 뱃지
        ▼
[4] 담당자가 gcube.ai 가서 실제 가격 변경
        │
        ├─(a) 다음 자동 파싱(매일) → match 되면 자동 "반영됨"        (이미)
        └─(b) 즉시 수동 마킹: "홈페이지 반영 완료" 버튼              ← 신규(B)
                │  gcube_reflected_at/by 기록 + audit('gcube_reflected')
                ▼
[5] 이력: 전략가 변경 + 반영 완료 + 파싱 결과 모두 타임라인          (대부분 이미)
```

**핵심 가치(사용자 의도):** 실제 홈페이지가 아직 안 바뀌어도 → 화면에서 "미반영"으로 **상태가 박제**되어, 담당자가 "아 아직 안 바꿨네" 확인하고 빨리 가서 바꿀 수 있음. 바꾼 뒤엔 "반영 완료"로 마킹하거나 다음 파싱이 자동 확인.

---

## 5. 설계 — 화면

### A. 통합표 상세 "가격 결정" 섹션 (기존 콕핏 기능 이식)
선택 제품 상세 패널에 한 카드로:
- **추천 판매가** ₩X (공급원가 ₩Y × 마진 +Z% · 출처: 전파/실견적 공급사) — [근거 펼침]
- **전략가(우리 판매가)** ₩S — [수정] (인라인, reason 입력)
- **gcube 공시 파싱가** ₩P (수집일 · 출처 gcube.ai) + **동기화 뱃지**(반영됨/미반영/미발견)
- 버튼: **[추천가로 반영]**(추천→전략가 1클릭) · **[홈페이지 반영 완료]**(수동 마킹)
- 하단: 전략가 변경 이력(최근 5건, 기존 strategic_history 재사용)

### C. 일괄 반영 리스트 (신규 화면/탭)
- "미반영(mismatch)" 제품만 모아보는 리스트 (전략가 ≠ 파싱가)
- 컬럼: 모델 · 전략가 · gcube 파싱가 · 차이 · 동기화상태 · 체크박스
- 일괄: 선택 → **[추천가로 일괄 전략가 확정]** / **[일괄 반영 완료 마킹]**
- 경쟁사 탭 bulk 패턴(`competitors/bulk`) 재사용

---

## 6. 설계 — 데이터(신규 최소)

마이그레이션 1개(082+):
```sql
ALTER TABLE gpu_products
  ADD COLUMN gcube_reflected_at  timestamptz,   -- 홈페이지 반영 완료 마킹 시각
  ADD COLUMN gcube_reflected_by  text,           -- 반영한 사람
  ADD COLUMN gcube_reflected_price_krw bigint;    -- 반영 당시 목표가(전략가 스냅샷)
-- audit action_type 'gcube_reflected' CHECK 확장 (gpu_audit_logs)
```
> 추천가·전략가·파싱가·동기화·이력은 **기존 컬럼/테이블 그대로** — 신규는 "반영 완료 추적" 3컬럼 + audit 1종뿐.

**API 신규(읽기/쓰기 최소):**
- `POST /api/pricing/gpu/strategic-price/bulk` (일괄 전략가 확정, admin)
- `POST /api/pricing/gpu/gcube-reflected` (반영 완료 마킹, admin, 단건/일괄)
- (읽기) 미반영 목록은 기존 cockpit/gcube-check 응답 필터로 가능 → 신규 불필요할 수 있음

---

## 7. 단계(Phase) 제안

- **P1 (작게)**: 통합표 상세에 "가격 결정" 카드 이식(추천가·전략가·파싱가·동기화 뱃지·추천가 반영 버튼). **신규 DB 0, 기존 API 재사용.** → 사용자가 한 화면에서 다 봄.
- **P2**: "홈페이지 반영 완료" 추적(컬럼 3 + 버튼 + audit). → 미반영/반영됨 상태 박제.
- **P3**: 일괄 반영 리스트(미반영 모아보기 + bulk 확정/마킹).

---

## 8. 미결 질문 (구현 착수 전 확인 필요)

1. "반영"의 정확한 의미: 전략가 확정(목표 설정)인가, 실제 홈페이지 변경 마킹인가 → **둘 다 분리**(반영=전략가 확정 / 반영완료=홈페이지 실변경 마킹)로 설계함. 맞나?
2. 추천가의 '근거'에 경쟁가 대비 포지셔닝(시장 중앙 대비 ±%)도 같이 보여줄까?
3. 일괄은 통합표 안 탭으로? 별도 화면으로?
4. gcube 파싱가가 범위(low~high)인데, 동기화 비교 기준은 전략가 단일값 vs 범위 — 현행 로직 유지?
