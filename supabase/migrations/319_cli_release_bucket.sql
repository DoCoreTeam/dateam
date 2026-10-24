-- 319: teamda 실행 파일 보관함 (P0167 I01)
--
-- 개발자센터와 teamda release 가 같은 파일을 내려주려면 바이트를 둘 자리가 있어야 한다.
-- 실행 파일은 116MB 라 Vercel 정적 파일로 두면 배포마다 같이 실린다, 그래서 버킷에 둔다.
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 버킷 하나. 비공개이고 표는 없다
--   ② 새 창구를 여나 — 이 파일은 아니다. 받기 창구는 app/api/cli/release 이고
--      로그인한 사람에게만 600초짜리 서명 주소를 준다
--   ③ 밖에서 온 값을 다루나 — 아니다. 올리는 쪽은 서비스롤을 쓰는 사내 스크립트 하나뿐
--
-- storage.objects 에 이 버킷용 정책을 두지 않는다. 읽기와 쓰기는 전부 서버(서비스롤)가 하고,
-- 정책이 없으면 authenticated 와 anon 은 기본 거절이다.
--
-- 크기 상한 100MB: 압축한 Windows 파일이 41MB, 두 배 남짓 여유
--
-- 되돌리기: delete from storage.objects where bucket_id = 'cli-release';
--           delete from storage.buckets where id = 'cli-release';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cli-release', 'cli-release', false, 104857600,
        array['application/zip', 'application/gzip', 'application/json'])
on conflict (id) do nothing;
