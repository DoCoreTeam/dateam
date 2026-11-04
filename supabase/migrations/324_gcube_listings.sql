-- 324 gcube 사이트 상품 표 (P0177 I02)
--
-- 왜: 판매가는 gcube 사이트에 실제로 걸린 금액이다
--   사이트 상품은 고유 번호(ser)가 있고 이름은 겹친다 (156건 중 이름 92개, T4 1장 16GB 가 280 350 560 셋)
--   그래서 이름이 아니라 ser 로 받고, 우리 모델(gpu_products)과는 사람이 한 번 확인해 잇는다
--   옛 표 gcube_price_checks 는 화면 글을 긁어 이름으로 맞춘 결과라 그대로 두고 새로 쓰지 않는다
--
-- 금액: 원화 1시간, 구성 전체
--   base_krw = 사이트 price (기본요금), usage_krw = usagePrice, max_krw = 둘의 합 (100% 사용 금액, 판매가 기준)
--
-- 보안 (LOOP.md 7절)
--   S1 같은 마이그레이션에서 RLS 를 켬, TO public 정책 없음, anon 권한 회수
--   읽기는 로그인한 사람, 쓰기 정책은 두지 않음 (관리자 확인을 지난 서비스롤 창구만 씀)
--
-- 되돌리기
--   drop table if exists public.gcube_listings;

create table if not exists public.gcube_listings (
  ser                  integer primary key,
  gpu_name             text not null,
  product_name         text,
  product_code         text,
  gpu_count            integer not null check (gpu_count between 1 and 64),
  vram_gb              integer check (vram_gb is null or vram_gb >= 0),
  cpu                  integer,
  memory_gb            integer,
  disk_gb              integer,
  base_krw             numeric(14, 2) not null check (base_krw >= 0),
  usage_krw            numeric(14, 2) not null default 0 check (usage_krw >= 0),
  max_krw              numeric(14, 2) generated always as (base_krw + usage_krw) stored,
  listed               boolean not null default true,
  product_id           uuid references public.gpu_products(id) on delete set null,
  suggested_product_id uuid references public.gpu_products(id) on delete set null,
  linked_at            timestamptz,
  linked_by            uuid references auth.users(id) on delete set null,
  fetched_at           timestamptz not null default now(),
  price_changed_at     timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

comment on table public.gcube_listings is 'gcube 사이트 상품, ser 기준, 판매가의 출처';
comment on column public.gcube_listings.max_krw is '판매가 기준, 구성 전체 1시간 원화 (기본 + 이용요금)';
comment on column public.gcube_listings.product_id is '사람이 확인해 이은 우리 모델, 모델 하나에 상품 하나';
comment on column public.gcube_listings.suggested_product_id is '모델명 장수 장당 메모리가 하나로 맞을 때만 채우는 제안';
comment on column public.gcube_listings.listed is '마지막 가져오기에서 사이트에 있었나';
comment on column public.gcube_listings.price_changed_at is '금액이 마지막으로 바뀐 때 (처음 받은 때 포함)';

create unique index if not exists gcube_listings_product_once
  on public.gcube_listings (product_id) where product_id is not null;

alter table public.gcube_listings enable row level security;
revoke all on public.gcube_listings from anon;

drop policy if exists gcube_listings_read on public.gcube_listings;
create policy gcube_listings_read on public.gcube_listings
  for select to authenticated
  using ((select auth.uid()) is not null);
