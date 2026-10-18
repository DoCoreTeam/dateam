-- 309: 첨부 대상에 계약서 템플릿을 더한다 (P0132 I07)
--
-- 계약서 파일로 템플릿을 만들면 원본 파일을 그 템플릿의 첨부로 남긴다.
-- 첨부 대상 열거형에 그 값이 없어 원본 기록이 DB 에서 거절되던 자리다.
--
-- **값을 더하기만 한다.** 표 칼럼 변경 0, 기존 행 변경 0.
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 새 표는 없다. 원본은 기존 crm_attachment 표(RLS 켜짐, 227)와
--      비공개 버킷에 들어간다
--   ② 새 창구를 여나 — 이 파일은 아니다. 창구는 관리자 전용 from-file 라우트다.
--      일반 첨부 창구의 대상 목록(lib/crm/services/attachment.ts TARGETS)에는 이 값을 넣지 않는다
--   ③ 밖에서 온 값을 다루나 — 아니다
--
-- 되돌리기: 열거형 값은 지울 수 없다. 이 값을 쓴 첨부 행을 지운 뒤 남겨 두면 해가 없다.

ALTER TYPE "CrmAttachmentTarget" ADD VALUE IF NOT EXISTS 'CONTRACT_TEMPLATE';

-- 계약서 원본 형식을 버킷이 받게 한다 (F-10 실측: 텍스트 원본이 버킷 형식 제한에 걸려 안 남았다)
--
-- 비공개 버킷이고 내려받기는 5분짜리 서명 주소뿐이다. 일반 첨부 창구는 자기 허용 목록
-- (ATTACHMENT_MIME_OK)으로 계속 거르므로 이 값들은 관리자 템플릿 창구만 쓴다.
-- 형식은 브라우저 주장이 아니라 매직바이트로 판정한 종류에서 정한다(sourceMimeOf).
-- 텍스트는 html 이어도 text/plain 으로만 들어온다.
--
-- 되돌리기: 아래 배열에서 더한 여덟 값을 빼서 다시 UPDATE

UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT m ORDER BY m) FROM unnest(allowed_mime_types || ARRAY[
    'application/x-hwp',
    'application/hwp+zip',
    'application/rtf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ]) AS m
)
WHERE id = 'crm-attachment';
