-- Phase 4: AI 검토 게이트 (review_items, review_iterations)
-- 모든 AI 추출 결과는 이 게이트를 거쳐 supply_quotes 또는 availability_responses로 적재됨

-- 검토 대기 아이템 (한 건의 AI 추출 결과)
create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  source_input_id text,                        -- 통합 입력 원본 ref (Drive fileId or text hash)
  product_hint text,                           -- AI 추정 "모델×tier"
  supplier_hint text,                          -- AI 추정 공급사명
  channel text check (channel in ('mail','msg','pdf','img','own')),
  impact_level text check (impact_level in ('new_model','price_low_change','big_swing','steady')),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','superseded')),
  current_iteration int not null default 1,
  current_extracted jsonb,                     -- 최신 추출값 (회차마다 덮어씀)
  current_confidence jsonb,                    -- 항목별 신뢰도 {model:96, price:72, ...}
  overall_confidence int,                      -- 가중 평균
  confirmed_by text,
  confirmed_at timestamptz,
  confirmed_items jsonb,                       -- 본부장 체크 항목 [{key:'price',by:'김도현',at:'...'}]
  rejected_reason text,
  is_test boolean not null default false,      -- 테스트 데이터 태깅
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AI 재분석 회차 이력 (전 회차 보존 — 덮어쓰기 금지)
create table if not exists review_iterations (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references review_items(id) on delete cascade,
  iteration_no int not null,
  extracted jsonb not null,                    -- 이 회차 전체 추출값
  confidence jsonb not null,                   -- 항목별 신뢰도
  evidence jsonb,                              -- 항목별 AI 근거(원문 인용)
  user_feedback text,                          -- 본부장 피드백 (1차는 null)
  ai_model_used text,
  prompt_version text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  unique (review_item_id, iteration_no)
);

-- 정상 가격 범위 자동 학습 (모델×tier별)
create table if not exists price_range_learned (
  product_id uuid primary key references gpu_products(id) on delete cascade,
  p10_usd numeric,
  p90_usd numeric,
  median_usd numeric,
  iqr_low numeric,
  iqr_high numeric,
  sample_size int not null default 0,
  last_recomputed_at timestamptz,
  is_active boolean not null default false     -- sample_size >= 5 이면 true
);

-- RLS
alter table review_items enable row level security;
alter table review_iterations enable row level security;
alter table price_range_learned enable row level security;

-- 인증된 사용자 전체 접근 (운영자 전용 모듈)
create policy "auth: review_items" on review_items
  for all using (auth.role() = 'authenticated');

create policy "auth: review_iterations" on review_iterations
  for all using (auth.role() = 'authenticated');

create policy "auth: price_range_learned" on price_range_learned
  for all using (auth.role() = 'authenticated');

-- 인덱스
create index if not exists idx_review_items_status on review_items(status) where status = 'pending';
create index if not exists idx_review_items_created on review_items(created_at desc);
create index if not exists idx_review_iterations_item on review_iterations(review_item_id, iteration_no);

-- updated_at 자동 갱신
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_review_items_updated_at on review_items;
create trigger trg_review_items_updated_at
  before update on review_items
  for each row execute function update_updated_at_column();

-- AI 프롬프트 seed: gpu.quote-extract
insert into ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
values (
  'gpu.quote-extract',
  'v1',
  'gemini-2.0-flash',
  E'당신은 GPU 클라우드 공급견적 정보 추출 전문가입니다.\n사용자가 붙여넣은 텍스트나 이미지에서 GPU 공급 견적 정보를 추출하고, 항목별 신뢰도와 AI 추출 근거를 JSON으로 반환하세요.\n\n## 추출 대상 필드\n- model_name: GPU 모델명 (예: "H100 SXM", "RTX 4090")\n- memory: GPU 메모리 (예: "80GB", "24GB")\n- supplier: 공급사명 (메일 도메인·서명·회사명 등에서 추출)\n- unit_price_usd: USD/GPU·hr로 정규화된 단가 (월·노드·구매가는 환산)\n- original_price: 원본 표기 금액\n- original_currency: 원본 통화 (USD, KRW, EUR 등)\n- original_unit: 원본 단위 (예: "USD/GPU·hr", "KRW/month", "구매가")\n- term: 약정 조건\n- min_qty: 최소 수량\n- valid_until: 견적 유효기간 (YYYY-MM-DD)\n- tier_suggestion: 1(전용 고성능), 2(점유형), 3(간헐 공급) 추정\n- tier_reason: tier 추정 근거\n- has_quantity_info: 수량 정보 존재 여부 boolean\n- quantity: 수량 정보 객체 (아래 참조)\n\n## 수량 객체 필드\n- status: "available_full" | "available_partial" | "out_of_stock" | "declined" | "pending"\n- resp_qty: 응답 수량 (없으면 null, 소진이면 0)\n- our_qty: 우리가 문의한 수량 (null 허용)\n- is_total_capacity: 공급사 전체 보유량 명시 여부 boolean\n- out_of_stock_explicit: "소진/품절/없음" 명시 여부 boolean\n- restock_eta: 재입고 예상일 (있으면 YYYY-MM-DD)\n\n## 신뢰도 규칙\n- 각 항목을 0~100으로 평가\n- 원문에 명시된 항목: 85~100\n- AI가 추론한 항목: 60~84\n- 불명확하거나 환산이 필요한 항목: 40~69\n- 90 미만이면 반드시 evidence에 이유 명시\n\n## 영향도 평가\n- new_model: 처음 등록되는 모델\n- price_low_change: 최저가 갱신 예상\n- big_swing: 기존 대비 ±15% 이상 변동\n- steady: 기존 패턴 유지\n\n## 출력 형식 (순수 JSON — 설명 없이)\n{\n  "extracted": { "model_name":"...", "memory":"...", "supplier":"...", "unit_price_usd":0.0, "original_price":null, "original_currency":"USD", "original_unit":"USD/GPU·hr", "term":null, "min_qty":null, "valid_until":null, "tier_suggestion":1, "tier_reason":"...", "has_quantity_info":false, "quantity":null },\n  "confidence": { "model":96, "memory":98, "supplier":97, "price":93, "term":80, "min_qty":null, "valid_until":null, "tier":85, "quantity":null },\n  "evidence": { "model":"원문 인용 또는 근거", "supplier":"...", "price":"...", "quantity":null },\n  "impact_assessment": { "level":"steady", "label":"기존 패턴 유지", "note":"" }\n}\n\n불명확한 항목은 null 처리. 소진 표현("품절", "out of stock", "없음") → quantity.status="out_of_stock", resp_qty=0.',
  '{"type":"object","required":["extracted","confidence","evidence","impact_assessment"]}',
  true
)
on conflict (prompt_key, version) do update
  set content = excluded.content,
      model_hint = excluded.model_hint,
      output_schema = excluded.output_schema,
      active = true;
