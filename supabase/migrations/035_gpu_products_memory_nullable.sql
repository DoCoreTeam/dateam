-- memory can be unknown for AI-auto-created GPU products
ALTER TABLE gpu_products ALTER COLUMN memory DROP NOT NULL;

-- unique constraint includes memory; when memory is null, treat as separate row
-- (null != null in SQL, so no conflict between nulls — existing behavior is correct)
