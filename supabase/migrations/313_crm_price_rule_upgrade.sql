-- 313: 가격 기준 규칙 아홉째 종류 「전환」(UPGRADE) (P0137 I02)
--
-- gcube edge 의 「ENT 전환 구축」은 기존 STD 고객이 ENT 로 바꿀 때만 받는다. 그 고객인지는 지난 계약이 안다.
-- 규칙 body: {"item": 전환 품목, "from": 이미 산 품목, "to": 바꿀 품목}
-- CHECK 목록을 넓히고, 이미 있는 gcube edge 제품에 전환 규칙 한 줄을 이름으로 찾아 넣는다(이미 있으면 안 넣음).
--
-- 보안 (LOOP.md 7절): ① 새 표 없음, 있는 표의 CHECK 와 규칙 한 줄 ② 창구 없음 ③ 값의 종류 목록만 바뀜, RLS 그대로
-- 되돌리기: DELETE FROM crm_price_rule WHERE kind = 'UPGRADE' 뒤 311 의 CHECK 로 다시 건다.

ALTER TABLE "crm_price_rule" DROP CONSTRAINT IF EXISTS "chk_price_rule_kind";
ALTER TABLE "crm_price_rule" ADD CONSTRAINT "chk_price_rule_kind"
  CHECK ("kind" IN ('ONE_OF', 'WITH', 'INCLUDES', 'QTY_FROM', 'CAP', 'ELIGIBLE', 'DISCOUNT', 'SCALE_CAP', 'UPGRADE'));

INSERT INTO "crm_price_rule" ("id", "workspaceId", "productId", "position", "kind", "body", "isEnabled", "updatedAt")
SELECT
  'r313' || substr(md5(p."id"), 1, 21),
  p."workspaceId",
  p."id",
  COALESCE((SELECT max(r."position") + 1 FROM "crm_price_rule" r WHERE r."productId" = p."id"), 0),
  'UPGRADE',
  jsonb_build_object('item', sw."id", 'from', std."id", 'to', ent."id"),
  true,
  CURRENT_TIMESTAMP
FROM "crm_price_product" p
JOIN "crm_product" sw  ON sw."priceProductId" = p."id"  AND sw."name" = 'ENT 전환 구축'
JOIN "crm_product" std ON std."priceProductId" = p."id" AND std."name" IN ('STD', 'STD 기본 금액')
JOIN "crm_product" ent ON ent."priceProductId" = p."id" AND ent."name" IN ('ENT', 'ENT 기본 금액')
WHERE p."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "crm_price_rule" x WHERE x."productId" = p."id" AND x."kind" = 'UPGRADE');
