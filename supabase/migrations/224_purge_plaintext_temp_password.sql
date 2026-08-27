-- 224_purge_plaintext_temp_password.sql
--
-- ⚠️ 되돌릴 수 없는 데이터 변경이다. 223(스키마)과 일부러 분리했다 — 승인 단위가 다르다.
--
-- 무엇을 지우나: `api_access_requests.temp_password` 에 **평문으로** 남아 있는 임시 비밀번호.
--   승인 화면(app/admin/api-access/actions.ts)이 계정을 만들며 저장하고 승인 뒤에도 안 지웠다.
--   실측(2026-08-27): 승인 2건 · 평문 2건 잔존.
--
-- 잃는 것: 없다. 그 비밀번호는 이미 Supabase 인증에 설정돼 있고, 사용자는 첫 로그인에
--   반드시 바꾸게 되어 있다(must_change_password=true). 못 받았으면 관리자가 재설정하면 된다.
-- 얻는 것: 비밀번호가 평문으로 남아 있는 자리가 사라진다.
--
-- 코드 쪽은 223 과 함께 이미 저장을 멈췄다 — 이 파일은 **이미 쌓인 것**만 치운다.

update public.api_access_requests
   set temp_password = null
 where temp_password is not null;

comment on column public.api_access_requests.temp_password is
  '사용 중단(224). 비밀번호를 저장하지 않는다 — 승인 화면이 한 번 보여 주고 끝낸다.';
