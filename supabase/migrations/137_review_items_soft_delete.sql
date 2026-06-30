-- 137: review_items 소프트삭제 — 하드 delete 대신 deleted_at 마킹(오삭제 복구·감사 보존).
-- 기존 행은 deleted_at NULL(살아있음) 유지. 조회/확정은 deleted_at IS NULL만 대상.

alter table review_items add column if not exists deleted_at timestamptz;

-- 활성(미삭제) 행 조회 최적화 — pending 목록·확정 조회가 deleted_at IS NULL을 항상 동반.
create index if not exists idx_review_items_active on review_items (status, created_at desc) where deleted_at is null;
