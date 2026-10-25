-- 320: 승인 요청 취소 상태 (P0170 I08)
--
-- 키가 잘못 만든 승인 요청을 지울 길이 없었다(approval get 만 있었다), 그 키가 스스로 거둘 수 있게 한다
-- 실측 2026-10-25: 범위 밖 조회 13번이 승인 화면에 13건을 쌓았다
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나: 표는 그대로, status 에 CANCELLED 값 하나가 늘 뿐이다. RLS 는 318 에서 켜져 있다
--   ② 새 창구를 여나: app/api/public/v1/approvals/{id}/cancel, 요청을 만든 그 키만 PENDING 을 CANCELLED 로 바꾼다
--   ③ 밖에서 온 값을 다루나: 경로의 id 하나, uuid 꼴만 받는다
--
-- 되돌리기: update public.api_approval_requests set status = 'EXPIRED' where status = 'CANCELLED';
--           그 뒤 아래 제약을 CANCELLED 없이 다시 건다

alter table public.api_approval_requests drop constraint if exists api_approval_requests_status_check;
alter table public.api_approval_requests add constraint api_approval_requests_status_check
  check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED'));
