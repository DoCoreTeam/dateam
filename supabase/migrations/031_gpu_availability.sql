-- Phase 6: 수량 트랙 (availability_responses, inquiries)

-- 우리가 보낸 문의 (수량 요청)
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references gpu_products(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  qty_asked int,
  channel text check (channel in ('mail','msg','pdf','img','own')),
  sent_at timestamptz not null,
  sent_by text,
  message_body text,
  evidence_drive_file_id text,
  follow_up_after timestamptz,                 -- sent_at + 3일 (미회신 알림)
  responded_at timestamptz,
  status text not null default 'open' check (status in ('open','responded','no_response','withdrawn')),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

-- 가용 수량 응답 (문의-응답 쌍)
create table if not exists availability_responses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references gpu_products(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  inquiry_id uuid references inquiries(id) on delete set null,
  our_qty int,

  status text not null check (status in (
    'available_full','available_partial','out_of_stock','declined','pending'
  )),
  resp_qty int,                                -- oos면 0, pending이면 null
  is_total_capacity boolean not null default false,
  unit_price_usd numeric,                      -- 단가도 같이 온 경우

  channel text check (channel in ('mail','msg','pdf','img','own')),
  evidence_drive_file_id text,
  evidence_hash text,
  ai_confidence int check (ai_confidence between 0 and 100),

  received_at timestamptz not null,
  expires_at timestamptz,                      -- received_at + 72h
  is_current boolean not null default true,    -- (공급사×상품) 최신 1행만 true
  confirmed_by text,
  confirmed_at timestamptz,
  review_item_id uuid references review_items(id) on delete set null,

  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

alter table inquiries enable row level security;
alter table availability_responses enable row level security;

create policy "auth: inquiries" on inquiries
  for all using (auth.role() = 'authenticated');

create policy "auth: availability_responses" on availability_responses
  for all using (auth.role() = 'authenticated');

-- 인덱스
create index if not exists idx_inquiries_product on inquiries(product_id, sent_at desc);
create index if not exists idx_inquiries_supplier on inquiries(supplier_id);
create index if not exists idx_inquiries_status on inquiries(status) where status = 'open';

create index if not exists idx_avail_product_current on availability_responses(product_id) where is_current = true;
create index if not exists idx_avail_supplier on availability_responses(supplier_id);
create index if not exists idx_avail_expires on availability_responses(expires_at) where is_current = true;
create index if not exists idx_avail_fresh on availability_responses(product_id, received_at desc)
  where is_current = true and confirmed_at is not null;

-- 신선 가용량 뷰 (가격표 컬럼용)
create or replace view v_fresh_availability as
select
  ar.product_id,
  ar.supplier_id,
  ar.status,
  ar.resp_qty,
  ar.is_total_capacity,
  ar.received_at,
  ar.expires_at,
  ar.is_current,
  case
    when ar.expires_at > now() and ar.confirmed_at is not null then 'fresh'
    when ar.expires_at <= now() then 'stale'
    when ar.confirmed_at is null then 'pending_review'
    else 'unknown'
  end as freshness
from availability_responses ar
where ar.is_current = true;

-- 가격표용 가용량 집계 함수 (product_id별)
create or replace view v_product_availability_summary as
select
  product_id,
  coalesce(sum(resp_qty) filter (
    where status in ('available_full','available_partial')
    and freshness = 'fresh'
  ), 0) as fresh_available_qty,
  count(*) filter (where status = 'out_of_stock' and freshness = 'fresh') as oos_supplier_count,
  count(*) filter (where freshness = 'stale') as stale_count,
  count(*) filter (where freshness = 'pending_review') as pending_review_count,
  max(received_at) as latest_response_at
from v_fresh_availability
group by product_id;
