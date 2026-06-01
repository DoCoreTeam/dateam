# Claude Code 핸드오프 — gcube GPU 가격관리 모듈

> **사용법**: 이 문서 전체를 Claude Code에 붙여넣고, 첨부 파일 `gcube-pricing-module-v0.7.0.html`(시각 명세/UI 정본)을 함께 첨부. HTML은 **최종 UI·동작의 기준**이며, 이 문서는 **데이터·로직·연동의 기준**

> **이 문서 버전**: `v0.5.0` (HTML 프로토타입 v0.7.0 기준 — 검토 신뢰도 강제 응시 + AI 재분석 루프)

---

## 0. 역할과 목표

- 기존 사내 시스템(**daaxb / AX사업본부 어드민**, Next.js · Vercel 배포)에 **`가격정책 > GPU 가격관리`** 모듈을 신규 추가
- 목적: 여러 공급사로부터 산재된 포맷(메일·메신저 캡처·견적서 파일)으로 들어오는 GPU 공급 견적을 **자동 정제 → 단일 가격표로 통합**하고, 수기 엑셀 정리를 제거하는 것
- 첨부 HTML 프로토타입(`v0.6.2`)의 6개 탭(가격표 / 통합 입력 / 재고/문의 / 검토 대기 / 공급사 / 변동 이력)을 실제 동작 기능으로 구현

---

## 1. 전제 스택 (이미 연결됨)

- **프론트/백엔드**: 기존 daaxb 시스템 스택을 그대로 사용 (Next.js 기반 추정 — 실제 레포 구조 확인 후 맞출 것)
- **DB**: **Supabase** (시스템에 연결됨) — 신규 테이블·RLS·뷰를 이 모듈용으로 추가
- **파일 저장**: **Google Drive** (시스템에 연결됨) — 근거자료 원본 보관에 사용
- **환율**: **한국수출입은행 환율 OpenAPI** (AP01) — 매 영업일 1회 매매기준율 fetch
  - 참고: https://www.koreaexim.go.kr/ir/HPHKIR020M01 (환율 OpenAPI, 무료 인증키 발급 필요)
  - 인증키는 환경변수(`KOREAEXIM_API_KEY`)로 관리, 코드/커밋에 노출 금지
- **LLM(견적 정제)**: **daaxb 시스템에 이미 설정되어 있는 LLM 설정을 찾아 그대로 재사용** (환경변수·config·기존 LLM 클라이언트 래퍼 등). 새 LLM 도입·신규 API 키 추가 금지. 어디에 설정돼 있는지 불확실하면 추측하지 말고 시스템 설정 위치를 먼저 탐색·확인. 이 모듈은 Data Alliance 영업본부 소속이므로 KDC/MACC 제품 아키텍처(멀티에이전트·ADGO 등)와 분리

---

## 2. 핵심 개념 — Tier (가장 중요)

gcube의 tier는 GPU 등급이 아니라 **공급 보장 방식**으로 나뉨:

| Tier | 명칭 | 정의 | 가격 결정 방식 |
|---|---|---|---|
| **Tier 1** | 전용 고성능 | H100·B200·A100·V100·T4 등 데이터센터급 **전용 점유** (보장형) | **공급견적 기반** (원가 추적) |
| **Tier 2** | 점유형 | 예약·점유하여 단독 사용 (보장형, 주로 RTX 고성능) | **공급견적 기반** (원가 추적) |
| **Tier 3** | 간헐 공급 | 공급사가 단속적으로(중단/재개) 제공하는 방식 | **판매가 직접 입력** (견적 없음) |

### 락(LOCK)된 설계 결정

1. **상품의 단위 = `모델 × tier`** — 같은 GPU라도 tier가 다르면 **별개 상품·별개 가격** (예: RTX 5090이 Tier 2와 Tier 3에 동시 존재, 가격 다름)
2. **최저가 비교는 반드시 동일 `(모델 × tier)` 안에서만 수행** — Tier 3가 Tier 1을 "최저가"로 이기는 비교는 금지
3. **Tier 1·2 = 공급견적 흐름** / **Tier 3 = 판매가 직접 입력 흐름** — 두 흐름을 명확히 분리
4. **모든 공급가는 `USD / GPU·hr` 로 정규화**해 저장 (월·노드·구매가 등 다른 단위로 들어와도 환산) — 정규화 없으면 최저가 비교가 무의미
5. **AI 정제 결과는 곧바로 가격표에 반영하지 않고 "검토 대기" 게이트를 거침** (사람 확정) — 오인식이 가격표를 오염시키는 사고 방지
6. **tier 판정 = AI 추천 → 사람 확정** (Tier 1·2 한정. Tier 3는 등록 자체가 직접 입력이라 해당 없음)
7. **마진 = 전역 단일값** (모델별 개별 마진은 이번 범위 제외, 다음 버전)

---

## 2-A. 수량 추적 트랙 (Availability) — v0.5.0에서 추가됨

> 핵심: **"얼마에 살까"와 "몇 장 잡을 수 있나"는 별개 차원**. 가격이 그대로여도 수량은 시간 단위로 바뀐다. 그래서 가격 트랙과 평행하게 별도 트랙으로 추적한다.

### 락(LOCK)된 설계 결정 (수량 트랙)

1. **수량은 "문의-응답 쌍(inquiry-response pair)"으로 저장** — 컨텍스트(우리가 얼마 물어봤는지, 언제, 무슨 채널로) 없이 응답 단독으로 두면 안 됨
2. **응답 상태 5종** (1급 enum):
   - `available_full` — 문의 수량 전량 가능
   - `available_partial` — 일부만 가능 (`resp_qty < our_qty`)
   - `out_of_stock` — **현재 0장 (재고 소진)** ← 명시값으로 기록, "데이터 없음"과 구분
   - `declined` — 공급 거절 (가격·조건 불일치)
   - `pending` — 문의는 보냈으나 회신 대기
3. **`is_total_capacity` boolean** — 응답이 "공급사 전체 보유량 명시"인지(드뭄), "우리 문의 한도 내 부분 응답"인지(대부분) 구분. UI에서 ⭐ 표시
4. **신선도 만료 = 72시간** — 그 안에 같은 (공급사·상품) 페어로 새 응답 없으면 stale. 가격표 가용량 합산 시 stale은 **제외 또는 회색 처리**
5. **미회신 임계값 = 3일** — 문의 후 3일 응답 없으면 자동 follow-up 후보로 마크
6. **가격표 가용량 합계 = 신선·확정 응답만 합산** (소진 0장 명시값은 별도 표시, 합계엔 0으로 들어감)
7. **상세 감사 이력 보존** — 모든 문의·응답·상태변화·재공급 약속·미회신을 (공급사 × 상품) 페어별 타임라인에 영구 보존. 영업 협상 시 근거 자료로 활용 (예: "3주 전 같은 모델에 N장 단가 X였는데 변경 사유" 등 객관적 근거 제시)

### 데이터 모델 (Supabase 추가 테이블)

```sql
-- 가용 수량 응답 (문의-응답 쌍)
availability_responses(
  id uuid pk default gen_random_uuid(),
  product_id uuid references gpu_products(id),
  supplier_id uuid references suppliers(id),

  -- 문의 측 (inquiry)
  inquiry_id uuid references inquiries(id),     -- 우리가 보낸 문의 (없을 수도 있음 — 공급사가 먼저 보낸 경우)
  our_qty int,                                  -- 우리가 물어본 수량 (응답이 unsolicited면 null)

  -- 응답 측 (response)
  status text not null check (status in
    ('available_full','available_partial','out_of_stock','declined','pending')),
  resp_qty int,                                 -- 응답 수량 (oos면 0, pending이면 null)
  is_total_capacity boolean default false,      -- ⭐ 공급사 전체 보유량 명시인지
  unit_price_usd numeric,                       -- 단가가 같이 왔으면 기록 (가격 트랙은 supply_quotes로 별도 적재)

  -- 메타
  channel text,                                 -- 'mail'|'msg'|'pdf'|'img'|'own'
  evidence_drive_file_id text,
  evidence_hash text,
  ai_confidence int,
  received_at timestamptz not null,
  expires_at timestamptz,                       -- received_at + 72h
  is_current boolean default true,              -- (공급사×상품)당 최신 한 행만 true
  status_changed_from text,                     -- 이전 상태 (히스토리용)

  registered_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz default now()
)

-- 우리가 보낸 문의 (수량 요청)
inquiries(
  id uuid pk default gen_random_uuid(),
  product_id uuid references gpu_products(id),
  supplier_id uuid references suppliers(id),
  qty_asked int,
  channel text,
  sent_at timestamptz not null,
  sent_by text,
  message_body text,                            -- 문의 본문 (검색·이력용)
  evidence_drive_file_id text,
  follow_up_after timestamptz,                  -- sent_at + 3일 (미회신 알림)
  responded_at timestamptz,                     -- 응답 받으면 채워짐
  status text default 'open' check (status in ('open','responded','no_response','withdrawn')),
  created_at timestamptz default now()
)

-- Tier 3 자체 풀 재고 (이력 포함)
direct_pool_stock(
  id uuid pk default gen_random_uuid(),
  product_id uuid references gpu_products(id),
  pool_qty int not null,
  note text,
  set_by text,
  set_at timestamptz default now(),
  is_current boolean default true
)
```

### 등록 흐름 — 입력 일원화 (v0.6.0 변경)

> **변경 핵심**: 사용자는 모드 선택 없이 **한 입력창에 내용만 붙이면**, AI가 **무슨 트랙으로 갈지 자동 분류**한다. 이전 v0.5.0의 3-모드 토글(Tier1·2 / 수량만 / Tier3)은 **제거**되었다.

```
[일원화된 단일 입력창]
  ─ 텍스트 자유 입력 (메일·메신저 본문 그대로 붙여넣기)
  ─ 다중 파일 첨부 (PDF, DOCX, HWP, 이미지)
  ─ Ctrl+V로 캡처 직접 붙여넣기
  ─ 드래그&드롭

     ↓ [AI로 분석 · 자동 분류]

AI 6단계 분석:
  1) 출처 포맷 · 언어 감지
  2) 공급사 식별 (도메인·서명·핸들·전화번호로 추정)
  3) GPU 모델 / 메모리 추출
  4) 가격 정보 탐지 → USD/GPU·hr 정규화
  5) 수량·재고 상태 탐지 (full / partial / oos / declined)
  6) tier 추정 + 신뢰도 산출 → 트랙 자동 분류

     ↓ [트랙 자동 분류]

  • 가격 + 수량 둘 다 있음  → supply_quotes + availability_responses 양쪽 적재
  • 가격만 있음              → supply_quotes
  • 수량만 있음              → availability_responses
  • "소진/0장/없음" 표현     → availability_responses (status='out_of_stock', resp_qty=0)
  • 공급사 미식별            → provisional supplier로 임시 보관 (v0.7 범위)

     ↓ [검토 대기 게이트] — 모든 트랙 공통

  사람이 확정 / 수정 / 반려 → 확정 시 가격표 · 재고 현황 · 타임라인에 반영
```

### Tier 3 자체 풀 재고는 별도 흐름 (분리)

Tier 3 모델의 **자체 풀 판매가/수량 직접 설정**은 일원화 입력창에서 처리하지 않고 **가격표 행에서 인라인 편집(편집 버튼 → 모달)**으로 분리. 이유: 텍스트 붙여넣기가 아니라 단순 숫자 입력이라 AI 분류 단계가 불필요하고 흐름이 단순해야 함.

```
가격표 Tier 3 행 → [편집] 클릭 → 모달
  ─ 판매가 (KRW/hr)
  ─ 자체 풀 재고 수량 (장)
  ─ 메모
  → 저장 시 즉시 가격표 반영 + 변동 이력에 기록 (검토 게이트 없음)
```

### 가용 수량 합계 규칙 (가격표 컬럼)

```
freshSum = SUM(resp_qty WHERE
  product = X
  AND status IN ('available_full','available_partial')
  AND is_fresh(received_at, 72h)
  AND is_current = true
  AND status = 'confirmed' (검토 게이트 통과)
)
```
- 소진(`out_of_stock`)은 합계에 0으로 들어가되 UI에 "소진 N곳" 별도 표시
- stale·pending은 합계 제외, UI에 "정보 오래됨 N · 응답 대기 N" 별도 표시

### 타임라인 (공급사 × 상품 단위)

각 (공급사 × 상품) 페어 페이지에 표시할 항목:
- 시간 역순 정렬, 문의·응답 쌍이 한 묶음으로 표시
- 각 응답에 상태 배지(5종) + 충족률(`resp_qty / our_qty`) + 단가(있으면) + 근거자료 링크(Drive)
- 미회신 건은 "회신 없음 D+N · 재문의 보내기 버튼" 표시 (V1은 버튼만, 실제 발송은 V2)
- 상단 요약: 응답률 / 평균 응답시간 / 평균 충족률 (최근 30일 윈도우)
- 필터: 상태·채널·기간·actor / CSV·PDF Export
- 변경/조회 모든 이벤트가 `audit_logs`에 영구 기록

### 새 audit_logs 액션 타입 (수량 트랙 추가분)

- `inquiry_sent` — 수량 문의 발송
- `availability_response_received` — 응답 수신·확정
- `stock_out_of_stock` — 소진 응답 기록
- `availability_status_changed` — 상태 전이 (full→partial→oos 등)
- `inquiry_no_response` — 미회신 임계 도달 (자동, D+3)
- `availability_expired` — 신선도 만료 (자동)
- `pool_stock_changed` — Tier 3 자체 풀 재고 변경

각 로그에는 (이전→새값), 채널, evidence_ref(Drive fileId + 해시), AI 처리 흔적, 사람 확정 흔적까지 jsonb로 모두 묶어 기록한다 — 협상·감사·롤백 시 추적 가능한 수준의 상세 이력 보존이 요구사항

### 재고/문의 뷰 — 모델 중심 리스트 (v0.6.0 변경)

> **변경 핵심**: 이전 v0.5.0의 "공급사 × 상품 매트릭스"는 **공급사 수가 늘면 가로 스크롤 지옥**이라 폐지. 영업 의사결정은 항상 **"이 모델 어디서 잡지?"**로 시작하므로 **모델이 1차 차원, 공급사는 펼침 정보**로 재편.

```
[모델별 리스트 — 한 줄에 한 모델]

GPU 모델 + Tier | 가용 합계 (장) | 공급사별 응답 요약 pill | 응답 분포 헬스바 | 최근 응답 | ▶
─────────────────────────────────────────────────────────────────────────────────────
H100 SXM (T1)  | 48장          | [GMI 16][FPT 24][ALF 8][MGZ 소진] | ▮▮▮▮▮▯ 3가용·1소진 | 2h 전 | ▶
H200 SXM (T1)  | 8장           | [FPT 8][GMI 대기]                 | ▮▮▯▯ 1가용·1대기   | 6h 전 | ▶
...
```

각 행 클릭 시 **공급사별 응답 카드**가 펼쳐짐 (현재 v0.5.0의 av-line 카드 그대로 활용):
- 공급사 라벨 / 수량 (`{resp_qty}장 / 문의 {our_qty}장` + ⭐ 전체 보유량 표시)
- 응답 상태 배지 (5종)
- 채널 + 수신 시각
- 신선도 점 (신선 / 정보 오래됨)
- 근거자료 / 해당 (공급사 × 상품) 타임라인 링크

### 응답 분포 헬스바

각 모델 행에 응답 상태 분포를 한 줄 헬스바로 시각화:
- 초록 = 전량 가능
- 황색 = 일부 가능
- 빨강 = 소진
- 보라(점선) = 응답 대기
- 회색 = 정보 오래됨

→ 한눈에 "여기 정보 신선도가 어느 정도냐"가 보임

---

## 3. 등록 흐름 — 참고 (입력 일원화 후 내부 동작)

> 위 §2-A "등록 흐름 — 입력 일원화"가 사용자 측 동작이고, 내부적으로는 분류된 트랙별로 다음 처리가 일어남.

### A. Tier 1·2 공급견적 흐름 (가격 트랙 — supply_quotes)

```
일원화 입력 → AI 분류에서 "가격 정보 있음" 판정
  → 원본을 Google Drive 업로드 (fileId·해시)
  → AI 정제: 모델·메모리·공급사·단가(USD/GPU·hr 정규화)·약정·유효기간·tier 추천·신뢰도
  → supply_quotes 에 status='pending' 적재
  → [검토 대기] 사람 확정
  → 확정 시 (모델×tier) 최저가 재계산 → 가격표 반영
  → 판매가 = 최저 공급가(USD) × (1 + 마진%) × 환율(KRW)
```

### B. 가용량 트랙 (availability_responses)

```
일원화 입력 → AI 분류에서 "수량 정보 있음" 판정 (가격 유무와 독립)
  → "소진/0장" 표현 → status='out_of_stock', resp_qty=0
  → "16장 가능" 같은 표현 → status='available_full' 또는 'available_partial'
  → 신선도 타이머 시작 (received_at + 72h)
  → [검토 대기] 사람 확정 → 재고/문의 뷰·가격표 가용량 컬럼·타임라인에 반영
```

### C. Tier 3 자체 풀 — 일원화 입력 흐름과 분리

```
가격표 Tier 3 행 → [편집] 모달 → 판매가(KRW) + 자체 풀 재고 직접 입력
  → AI·검토 게이트 없이 즉시 가격표 반영
  → 이전 값은 변동 이력에 보존 (롤백/근거용)
```

---

## 4. 데이터 모델 (Supabase / Postgres)

```sql
-- 공급사
suppliers(
  id uuid pk default gen_random_uuid(),
  name text not null,
  location text,            -- 예: '🇻🇳 베트남'
  contact text,
  color text,               -- UI 표시색
  created_at timestamptz default now()
)

-- 상품 = 모델 × tier
gpu_products(
  id uuid pk default gen_random_uuid(),
  model_name text not null,     -- 'H100 SXM'
  memory text not null,         -- '80GB'
  tier int not null check (tier in (1,2,3)),
  pricing_mode text not null,   -- 'quote' (T1/T2) | 'direct' (T3)
  created_at timestamptz default now(),
  unique(model_name, memory, tier)
)

-- 공급견적 로우데이터 (Tier 1·2)
supply_quotes(
  id uuid pk default gen_random_uuid(),
  product_id uuid references gpu_products(id),
  supplier_id uuid references suppliers(id),
  unit_price_usd numeric not null,   -- 정규화된 USD/GPU·hr (최저가 비교 기준)
  original_currency text,            -- 원본 통화 'USD'|'KRW'...
  original_price numeric,            -- 원본 표기 금액
  original_unit text,                -- 원본 단위 'USD/GPU·hr'|'KRW/month'|'구매가'...
  term text,                         -- 약정 조건
  min_qty text,                      -- 최소 수량
  valid_until date,                  -- 견적 유효기간
  source_format text,                -- 'mail'|'pdf'|'img'|'msg'|'own'
  evidence_drive_file_id text,       -- Google Drive fileId
  evidence_hash text,                -- 변조방지 해시(sha256)
  ai_confidence int,                 -- 0~100
  status text not null default 'pending', -- 'pending'|'confirmed'|'expired'|'rejected'
  received_at timestamptz,
  registered_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz default now()
)

-- Tier 3 직접 판매가 (현재값 + 변경 이력)
direct_prices(
  id uuid pk default gen_random_uuid(),
  product_id uuid references gpu_products(id),
  sell_price_krw numeric not null,
  note text,
  set_by text,
  set_at timestamptz default now(),
  is_current boolean default true     -- 새 값 insert 시 이전 값 false 처리
)

-- 환율 (일별 매매기준율)
fx_rates(
  rate_date date pk,
  usd_krw numeric not null,
  source text default 'koreaexim',
  fetched_at timestamptz default now()
)

-- 전역 설정
pricing_settings(
  id int pk default 1 check (id = 1),  -- 단일 행
  margin_pct numeric not null default 18,
  updated_by text,
  updated_at timestamptz default now()
)

-- 감사 로그 (모든 변경의 타임스탬프 기록)
audit_logs(
  id uuid pk default gen_random_uuid(),
  ts timestamptz default now(),
  actor text,
  action_type text,   -- 'quote_registered'|'quote_confirmed'|'lowest_changed'|'expired'|'direct_set'|'margin_changed'|'rejected'
  product_id uuid references gpu_products(id),
  detail jsonb,        -- { before, after, supplier, ... }
  evidence_ref text    -- drive fileId 또는 quote id
)
```

### 파생 뷰 (최저가)

```sql
-- (모델×tier)별 유효·확정 견적 중 최저 USD 단가
create view v_lowest_quotes as
select distinct on (product_id)
  product_id, id as quote_id, supplier_id, unit_price_usd, valid_until
from supply_quotes
where status = 'confirmed' and valid_until >= current_date
order by product_id, unit_price_usd asc;
```

- **가격표 한 행의 값**
  - Tier 1·2: `v_lowest_quotes.unit_price_usd` → 판매가 `= unit_price_usd × (1 + margin_pct/100) × usd_krw`, 환산 KRW `= unit_price_usd × usd_krw`
  - Tier 3: `direct_prices.sell_price_krw (is_current=true)`

---

## 5. 외부 연동 상세

### 5-1. 환율 (한국수출입은행 OpenAPI)

- 매 영업일(평일) 오전 1회 cron(Supabase Edge Function 스케줄 또는 Vercel Cron)으로 AP01 환율 조회 → `fx_rates` upsert
- 주말·공휴일: 직전 영업일 값 사용 (조회 실패/빈 응답 시 직전 row fallback)
- 가격표 KRW 환산·Tier 3 USD 환산 모두 **당일(없으면 직전 영업일) `usd_krw`** 사용
- 상단 표시: "오늘 매매기준율 1 USD = N원 · 자동" (HTML 참고)

### 5-2. Google Drive (근거자료 보관)

- 공급견적 등록 시 원본(메일 텍스트는 .txt/.eml, 캡처·이미지·PDF는 원본 파일)을 Drive에 업로드
- 경로: `/gcube_pricing/근거자료/{source_format}/{YYYY-MM-DD}/` (폴더 자동 생성 또는 폴더 ID 매핑)
- 업로드 후 반환 `fileId`를 `supply_quotes.evidence_drive_file_id`에 저장, 원본 sha256 해시를 `evidence_hash`에 저장
- 근거자료 뷰어: fileId로 Drive 미리보기/열기 링크 제공
- **금지**: 사용자 대신 Drive 계정 생성·비밀번호 입력 금지. 인증은 기존 시스템 연결을 사용

### 5-3. AI 정제 (Tier 1·2 전용)

추출 대상 필드(JSON 강제 출력):
```json
{
  "model_name": "H100 SXM", "memory": "80GB",
  "supplier": "GMI Cloud",

  "price": 2.10, "currency": "USD", "unit": "USD/GPU·hr",
  "unit_price_usd": 2.10,
  "term": "3개월 약정", "min_qty": "8장 이상",
  "valid_until": "2026-06-15",
  "tier_suggestion": 1,
  "tier_reason": "전용 점유 정황",

  "has_quantity_info": true,
  "quantity": {
    "status": "available_partial",
    "resp_qty": 16,
    "our_qty": 32,
    "is_total_capacity": false,
    "out_of_stock_explicit": false,
    "restock_eta": null
  },

  "confidence": 96,
  "price_present": true,
  "quantity_present": true
}
```
- 가격·수량 어느 한쪽만 들어와도 추출 (둘 중 없는 건 `null`)
- "소진/0장/품절/없음" 같은 표현 → `status: out_of_stock`, `resp_qty: 0`
- "보유 전량/전체 보유/우리가 가진 전부" 같은 표현 → `is_total_capacity: true`
- 단위 정규화 규칙: 월·노드·구매가 등은 사용 가능한 정보(시간 환산·GPU 수)로 `USD/GPU·hr` 환산. 통화는 당일 환율로 환산. 불명확 시 confidence 하향 + 검토 화면에 경고
- tier 추천은 **추천일 뿐**, 검토 화면에서 사람이 최종 확정. 견적에 tier 단서가 없으면 사람 지정

---

### 5-4. 시스템 신뢰도 게이트 (v0.7.0에서 추가됨) — 가장 중요한 안전장치

> 입력 일원화로 UX는 편해졌지만, **사용자가 검토 화면을 안 보고 통과시키는 위험**이 정확도의 가장 큰 적이다. 이 절은 그 위험을 막는 5중 방어선.

#### 락(LOCK)된 결정 (신뢰도 게이트)

1. **AI 추출은 항목별 신뢰도(item-level confidence)를 함께 산출** — 한 견적 안에서도 모델/단가/공급사/수량/tier/유효기간이 각각 다른 confidence를 가짐 (전체 평균값 한 개만 두면 안 됨)
2. **신뢰도 임계값 = 90%** — 미만 항목은 **검토 화면에서 본부장 직접 체크 필수** (체크박스 강제, 안 누르면 확정 버튼 비활성화)
3. **각 항목에 AI 추출 근거(원문 인용)를 의무 표시** — "어디서 뽑은 값인가"가 보여야 본부장이 빠르게 검증 가능
4. **자동 차단 룰 없음** — 자릿수·통화 등 의심 항목도 차단하지 않는다. 차단하면 데이터가 등록 안 되니, 대신 사용자 피드백을 받아 AI가 재분석해 정합성 확보 (`③ 결정`)
5. **AI 재분석 루프** — 본부장이 의문 부분을 텍스트로 피드백 → AI가 원문+피드백을 함께 재추출 → 회차별 이력 보존. 회수 제한 없음
6. **정상 가격 범위는 자체 거래 이력 기반 자동 학습** — 시드값 박지 않음. 모델별 확정 견적이 일정 수준(예: 5건) 누적되면 IQR/p10~p90 범위를 학습 → 새 견적이 이 범위 벗어나면 confidence를 자동 하향 → 결과적으로 강제 응시 대상이 됨 (`④ 결정`)
7. **영향도 표식** — `신규 모델 첫 견적` / `최저가 변경` / `±15% 이상 변동` / `기존 패턴 유지` 4단계로 카드 상단에 표시 (사용자가 어느 카드에 더 주의를 줄지 시각적 가이드)

#### 데이터 모델 (Supabase 추가)

```sql
-- 검토 대기 아이템 (한 건의 추출 결과)
review_items(
  id uuid pk default gen_random_uuid(),
  source_input_id uuid,                    -- 통합 입력의 원본 (Drive fileId·텍스트 ref)
  product_hint text,                       -- AI 추정 (모델×tier)
  supplier_hint text,                      -- AI 추정 공급사
  channel text,                            -- mail|msg|pdf|img|own
  impact_level text check (impact_level in ('new_model','price_low_change','big_swing','steady')),
  status text default 'pending' check (status in ('pending','confirmed','rejected','superseded')),
  current_iteration int default 1,
  current_extracted jsonb,                 -- 최신 추출값 (회차별 변경되어 덮어씀)
  current_confidence jsonb,                -- 항목별 신뢰도 {model:96, price:72, sup:88, ...}
  overall_confidence int,                  -- 가중 평균
  confirmed_by text,
  confirmed_at timestamptz,
  confirmed_items jsonb,                   -- 본부장이 체크한 항목 + 시각 [{key:'price',by:'김도현',at:'...'}]
  created_at timestamptz default now()
)

-- AI 재분석 회차 (모든 회차 이력 보존)
review_iterations(
  id uuid pk default gen_random_uuid(),
  review_item_id uuid references review_items(id),
  iteration_no int not null,               -- 1, 2, 3…
  extracted jsonb not null,                -- 이 회차 추출값 전체
  confidence jsonb not null,               -- 항목별 신뢰도
  user_feedback text,                      -- 이 회차에 본부장이 준 피드백 (1차는 null)
  ai_model_used text,                      -- 어떤 LLM 모델·버전을 썼는지
  prompt_id text,                          -- 프롬프트 버전
  created_at timestamptz default now()
)

-- 정상 가격 범위 자동 학습 (모델×tier별)
price_range_learned(
  product_id uuid references gpu_products(id),
  p10_usd numeric,                         -- 10퍼센타일
  p90_usd numeric,                         -- 90퍼센타일
  median_usd numeric,
  iqr_low numeric,
  iqr_high numeric,
  sample_size int,                         -- 학습에 쓰인 확정 견적 수
  last_recomputed_at timestamptz,
  is_active boolean default false          -- sample_size 5 이상일 때 true
)
```

#### AI 정제 JSON — 항목별 confidence + evidence

기존 `confidence: 96` 하나 대신 항목별로:

```json
{
  "extracted": { "model_name":"H100 SXM", "memory":"80GB", "supplier":"GMI Cloud",
                  "unit_price_usd":2.10, "term":"3개월 약정", "min_qty":"8장 이상",
                  "valid_until":"2026-06-15", "tier_suggestion":1,
                  "quantity":{"status":"available_full","resp_qty":8,"is_total_capacity":false} },
  "confidence": { "model":96, "memory":98, "supplier":97, "price":93,
                   "term":88, "min_qty":92, "valid_until":94,
                   "tier":85, "quantity":89 },
  "evidence": { "model": "발신 메일 제목·본문에 명시",
                 "supplier": "발신 도메인 @gmi-cloud.com + 서명 일치",
                 "price": "원문 인용: \"$2.10 per GPU per hour\" — 정상 범위($1.80~$3.50) 내 정상",
                 "quantity": "원문 인용: \"available 8 GPUs\" — \"전량/일부\" 명시 없음, AI 추정" },
  "impact_assessment": { "level":"price_low_change", "label":"최저가 후보",
                          "note":"기존 GMI $2.31 → $2.10 (−9%) 최저가 갱신 예정" }
}
```

#### 재분석 흐름 (sequence)

```
1차 분석   → review_items.current_* 에 적재, review_iterations(iter=1)
사용자 피드백 입력 → askAIRecheck
2차 분석   → 원본 + 1차 추출 + 피드백을 LLM에 함께 전달 → 새 extracted/confidence/evidence
            → review_items.current_* 덮어쓰기 + current_iteration += 1
            → review_iterations(iter=2)로 별도 저장 (1차는 보존)
... 회수 제한 없음 ...
본부장 확정 → review_items.status='confirmed', confirmed_items에 체크 기록
            → 가격 트랙(supply_quotes) / 가용량 트랙(availability_responses) / direct_pool_stock 으로 자동 적재
            → 변동 이력에 'recheck_confirmed' 액션 + 모든 회차 ref
```

#### UI 동작 요구사항 (HTML 참고)

- 검토 카드 상단: **종합 신뢰도 % + 영향도 pill + 재분석 회차 표식**
- 강제 체크 배너: low 항목이 1개라도 있으면 "**N개 항목이 본부장 직접 확인이 필요합니다**" 빨강 배너
- 각 ck-item: 신뢰도 < 90% → 빨강 테두리 + 좌측 체크박스 강제 + "본부장 확인 필수" 라벨 + AI 근거 인용 박스
- 진행도 표시: "**3 / 4** 항목 확인됨" 실시간 갱신, 모두 체크 시 "**N / N** 항목 확인 완료 — 확정 가능"으로 전환
- 확정 버튼: **저신뢰도 항목 모두 체크 전까지 disabled** (CSS만이 아니라 실제 비활성화)
- 재분석 박스: 텍스트 입력 + "AI에게 다시 분석 요청" 버튼 → 1~2초 후 신뢰도가 보강된 결과로 카드 자동 갱신, "재분석 N차" 뱃지 표시
- 회차별 이력은 카드에서 펼침형으로 조회 가능 (V1는 뱃지만, 펼침 UI는 V2)

#### 새 audit_logs 액션 타입 (신뢰도 게이트)

- `review_created` — 1차 분석 완료, 검토 대기 등록
- `review_recheck_requested` — 사용자 피드백 입력 후 재분석 요청
- `review_recheck_completed` — N차 재분석 결과 적용
- `review_item_confirmed` — 본부장이 항목 단위 체크
- `review_finalized` — 모든 강제 체크 통과 후 확정 (→ 트랙별 적재)
- `review_rejected` — 반려

각 로그에 `review_item_id`, `iteration_no`, 변경 항목 목록을 jsonb로 함께 기록.

---

## 6. 기능 요구사항 (탭별)

- **가격표**: (모델×tier) 행, tier 필터, 행 클릭 시 전체 견적 + 가용 응답 펼침. **가용 수량 컬럼 신설** — 신선·확정 응답 합산 + 소진/stale/pending 별도 표시. 마진 입력 시 판매가 즉시 재계산. 최저가/소진 알림 배너
- **통합 입력 (입력 일원화 — v0.6.0~v0.6.2)**: 모드 선택 없는 **단일 입력창**. 텍스트·다중 파일·이미지·Ctrl+V 캡처 모두 한 곳에서. AI가 분석 후 시스템 전체에 자동 분류·반영 — 가격은 가격표(Tier 1·2 공급견적), 수량은 재고/문의(가용량 응답), 공급사 미식별 시 공급사(임시 보관). 사용자는 어느 메뉴인지 고민하지 않고 내용만 붙임. **메뉴명은 "통합 입력"** (이전 "공급견적 등록"·"공급 정보 입력" 같은 좁은 명칭은 폐지)
- **재고/문의 탭 (모델 중심 — v0.6.0)**: 모델별 한 줄 리스트. 가용 합계 + 공급사 pill + 응답 분포 헬스바 + 최근 응답 시각. 행 클릭 시 공급사별 응답 카드 펼침. (이전 공급사×상품 매트릭스는 폐지)
- **검토 대기 (v0.7.0 강화)**: 항목별 신뢰도 표시 + 90% 미만 항목 **강제 체크박스** + AI 추출 근거(원문 인용) + 영향도 pill + AI 재분석 요청 박스(피드백 → 재추출, 회차 보존) + 확정 버튼 disable-by-default. 모든 강제 체크 통과 전까지 어느 트랙에도 미반영
- **공급사**: 공급사별 활성 견적·가용 응답·최근 수신일·응답률
- **변동 이력**: 가격 트랙 + 수량 트랙 모든 액션을 타임스탬프 로그로, 근거자료(Drive) 열람

---

## 7. 구현 순서 (Phase별 — 각 단계 끝에 동작+커밋)

| Phase | 버전 | 범위 |
|---|---|---|
| 1 | `v0.1.0` | Supabase 스키마(가격 트랙) + seed + 가격표 **읽기 전용** (T1/T2 최저가·T3 직접값, tier 필터, 행 펼침) |
| 2 | `v0.2.0` | 환율 cron + KRW 환산 + 전역 마진 설정 → 판매가 산출 |
| 3 | `v0.3.0` | 통합 입력 메뉴 — 멀티포맷 입력 + Drive 업로드 (**AI 없이 수동 폼 먼저**, 가격 트랙 적재만) |
| 4 | `v0.4.0` | AI 정제(가격 추출+단위 정규화+tier 추천+**항목별 confidence + 추출 근거**) → 검토 대기 게이트 → **저신뢰도 항목 강제 체크 + AI 재분석 루프** → 확정/반려 |
| 5 | `v0.5.0` | Tier 3 판매가 직접 입력 모드 + 자체 풀 재고 |
| 6 | `v0.6.0` | **수량 트랙 스키마** (`availability_responses`, `inquiries`) + 가격표 **가용량 컬럼** 읽기전용 + 응답 상태 5종 표시 |
| 7 | `v0.7.0` | **재고/문의 탭** — 모델별 가용 현황 리스트 + 공급사·상품 페어 상세 타임라인 + 등록 화면 "수량 응답만" 모드 |
| 8 | `v0.8.0` | AI 정제 확장 — 가격+수량 통합 추출(JSON), 소진/전체 보유량 감지. 신선도 만료 cron + 미회신 D+3 자동 마크 |
| 9 | `v0.9.0` | 변동 이력 통합(가격+수량 트랙 모든 액션) + 근거자료 뷰어 + 만료 자동 처리 + 최저가/소진 변경 알림 |
| 10 | `v1.0.0` | Excel / PDF Export (제안서·WIS·영업 협상 근거 자료용) + 재문의 메일·메신저 발송(템플릿) |

- 각 Phase는 **독립적으로 동작·배포 가능**해야 하며, 끝에서 사람이 확인 후 다음 진행

---

## 8. 버전·커밋 규칙

- 시맨틱 버저닝 `v0.0.0` 형식 사용, 롤백 가능하도록 단계별 분리
- 커밋 메시지에 **버전 명시** 필수
  - 예: `feat(pricing): 가격표 읽기전용 뷰 + tier 필터 v0.1.0`
  - 예: `feat(pricing): 환율 cron + 전역 마진 판매가 산출 v0.2.0`
- DB 변경은 마이그레이션 파일로 관리 (Supabase migrations)

---

## 9. 하지 말 것 (가드레일)

- Tier 3에 AI 정제·원가 추적·검토 게이트 붙이지 말 것 (직접 입력만)
- 모델별 개별 마진 구현 금지 (전역 마진만, 다음 버전)
- **`out_of_stock`(0장 명시)을 "데이터 없음(null)"과 같이 취급 금지** — 1급 정보로 분리 보존, 가격표·매트릭스에 명시적으로 노출
- **응답 단독으로 저장 금지** — 항상 문의 컨텍스트(우리 문의 수량·시각·채널)와 쌍으로 저장 또는 unsolicited 표시
- **공급사 전체 보유량 vs 부분 응답 구분 무시 금지** — `is_total_capacity` boolean 반드시 표시
- 결제·금융 데이터 입력, 문서/리소스 공유 권한 변경, 영구 삭제 등 민감 동작 없음
- 사용자 대신 계정 생성·비밀번호/인증키 입력 금지 (환율 인증키·Drive 인증은 환경변수·기존 연결 사용)
- KDC/MACC 제품 아키텍처(멀티에이전트 토론·ADGO 등) 패턴 도입 금지 — 이 모듈은 영업본부(Data Alliance) 소속
- **통합 입력 메뉴에 모드 토글·탭 분기 금지** — 입력 일원화 원칙. 사용자는 한 입력창에 내용만 붙이고, 분류는 AI가 시스템 전체에 자동 반영한다 (v0.6.0 결정)
- **통합 입력 메뉴명을 "공급견적 등록"·"공급 정보 입력" 같은 좁은 명칭으로 되돌리지 말 것** — 사용자가 입력 범위를 가격에 한정해 인식하게 만든다. 메뉴명은 **"통합 입력"**으로 고정 (v0.6.2 결정)
- **검토 게이트의 강제 체크박스를 비활성·생략하지 말 것** — 신뢰도 90% 미만 항목은 본부장 직접 체크 필수, 확정 버튼은 모두 체크 전까지 disable. UI에서 우회 경로(예: "건너뛰기" 버튼) 만들지 말 것 (v0.7.0 결정)
- **자릿수·통화·범위 위반을 자동 차단하지 말 것** — 차단하면 데이터 손실. 대신 신뢰도를 강제 하향시켜 강제 응시 대상이 되게 하고, 사용자 피드백 기반 AI 재분석으로 정합성 확보 (v0.7.0 결정)
- **AI 재분석 회차 이력을 덮어쓰거나 삭제하지 말 것** — `review_iterations`에 모든 회차 보존, 추후 AI 성능 개선·감사 추적 자료 (v0.7.0 결정)
- **항목별 신뢰도(item-level confidence)를 단일 신뢰도 한 개로 축소하지 말 것** — 한 견적에서 가격은 정확하고 공급사는 의심스러운 경우 등을 구분 못 함
- **재고/문의 뷰를 공급사 × 상품 매트릭스로 만들지 말 것** — 공급사 수 늘면 가독성 붕괴. **모델이 1차 차원**, 공급사는 펼침 정보 (v0.6.0 결정)

---

## 10. 시작 지점

1. 먼저 현재 daaxb 레포 구조·라우팅·인증·기존 Supabase 클라이언트 설정을 파악
2. `가격정책 > GPU 가격관리` 라우트를 기존 사이드바(프로젝트관리 아래)에 추가
3. Phase 1부터 진행, 첨부 HTML(`v0.4.0`)의 UI·동작을 기준으로 구현
4. 불명확한 지점(레포 스택, LLM 호출 방식, Drive 폴더 ID)은 추측하지 말고 질문
