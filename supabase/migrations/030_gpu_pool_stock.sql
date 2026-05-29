-- Phase 5: Tier 3 자체 풀 재고 (이력 포함)
create table if not exists direct_pool_stock (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references gpu_products(id) on delete cascade,
  pool_qty int not null check (pool_qty >= 0),
  note text,
  set_by text,
  set_at timestamptz not null default now(),
  is_current boolean not null default true,    -- 최신 1행만 true
  is_test boolean not null default false
);

alter table direct_pool_stock enable row level security;

create policy "auth: direct_pool_stock" on direct_pool_stock
  for all using (auth.role() = 'authenticated');

create index if not exists idx_pool_stock_product_current
  on direct_pool_stock(product_id) where is_current = true;

create index if not exists idx_pool_stock_product_history
  on direct_pool_stock(product_id, set_at desc);
