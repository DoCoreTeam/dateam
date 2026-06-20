-- 119_drop_app_releases.sql — 구 체인지로그 DB 파이프라인 제거.
-- 사용자향 업데이트 내역이 큐레이션 파일(apps/web/lib/changelog/entries.ts) 직독 SSOT로 전환됨(v0.7.207).
-- app_releases 테이블·정책·트리거·전용 함수는 더 이상 사용처가 없어 드롭한다(orphan).
-- ⚠️ destructive: 어드민이 작성/게시했던 체인지로그 행이 사라진다(사용자 콘텐츠는 entries.ts에 큐레이션됨).

drop table if exists public.app_releases cascade;        -- 정책·트리거·인덱스 동반 제거
drop function if exists public.app_releases_touch_updated_at();  -- 이 테이블 전용 트리거 함수
