-- 116_app_releases_member_role.sql — 체인지로그 게시분 읽기를 사내 멤버(admin/member)로 한정.
-- 기존 정책은 모든 인증 사용자(api_user 외부 컨슈머 포함)에게 게시분을 노출 → role 화이트리스트 추가.
drop policy if exists app_releases_member_read_published on public.app_releases;
create policy app_releases_member_read_published on public.app_releases
  for select
  using (
    is_published = true
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'member') and p.deleted_at is null
    )
  );
