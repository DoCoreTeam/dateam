-- 329: 첨부 대상에 계약서를 더한다 (P0184 I12c)
--
-- 딜 없는 계약은 서명본을 붙일 자리가 없었다. 체결 창이 딜 첨부에서만 서명본을 골랐기 때문이다.
-- 계약 자체를 첨부 대상으로 받는다.
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 새 표는 없다. 기존 crm_attachment(RLS 켜짐)와 비공개 버킷에 들어간다
--   ② 새 창구를 여나 — 아니다. 기존 첨부 창구가 대상 값을 하나 더 받는다.
--      그 창구는 계약 대상이면 계약 등급 거름망(회사 단위는 관리자만)을 먼저 지난다 (attachment.ts)
--   ③ 밖에서 온 값을 다루나 — 업로드 파일, 기존 형식 허용 목록과 크기 상한을 그대로 지난다
--
-- 관계 (CEO.md R-1 R-3): 계약 → 계약 첨부는 소유다. 대상이 폴리모픽이라 FK 를 못 걸어 트리거가 맡는다.
--   계약을 영구 삭제하면 그 계약의 첨부 행도 지운다. 버킷의 파일은 트리거가 못 지우므로
--   영구 삭제 창구가 먼저 지운다 (지우는 순서는 첨부 먼저, 본체 나중)
--
-- 되돌리기: DROP TRIGGER crm_contract_purge_attachments ON crm_contract;
--           DROP FUNCTION crm_contract_purge_attachments();
--           열거형 값은 지울 수 없다. 이 값을 쓴 행을 지운 뒤 남겨 두면 해가 없다

ALTER TYPE "CrmAttachmentTarget" ADD VALUE IF NOT EXISTS 'CONTRACT';

CREATE OR REPLACE FUNCTION crm_contract_purge_attachments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM crm_attachment WHERE "targetType"::text = 'CONTRACT' AND "targetId" = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER crm_contract_purge_attachments
  AFTER DELETE ON crm_contract
  FOR EACH ROW EXECUTE FUNCTION crm_contract_purge_attachments();
REVOKE ALL ON FUNCTION crm_contract_purge_attachments() FROM anon, authenticated, public;
