-- 275: 직인 기능이 없던 때 만들어진 견적에 **지금의 직인을 넣는다**
--
-- 왜: 274 가 직인을 「만든 날 그대로」 굳히게 했는데, 기존 견적은 그 칸이 비어 있다.
--   그래서 회사가 직인을 올려도 **이미 있는 견적서는 전부 「(직인생략)」으로 나온다**
--   (사용자 지적 2026-09-21: 「직인생략으로 나오네 파일이 있어도」).
--
--   274 를 쓸 때는 NULL 을 「그날 직인이 없었다」로 읽었다. 그건 틀린 독해였다 —
--   없었던 것은 **직인이 아니라 직인을 올릴 자리**다. 회사는 내내 도장을 찍어 보내 왔고
--   (이번 직인도 2026-07-27 자 견적서에서 오려 냈다), 우리 화면만 그걸 몰랐다.
--   그 견적들에 「(직인생략)」을 세우면 고객이 받은 종이와 우리 화면이 다른 말을 한다.
--
--   271 이 로고에 대해 같은 판단을 같은 이유로 이미 내렸다:
--   「그 견적이 만들어진 날의 값은 어디에도 없다 … 아무것도 안 넣으면 더 나쁘다」.
--   직인만 예외로 둘 이유가 없다.
--
-- 이 판이 도는 순간 존재하는 모든 견적은 **직인을 고를 수 없던 때에 만들어졌다**
-- (설정 항목이 v0.10.326 에 생겼다). 그래서 대상은 「지금 비어 있는 전부」다.
-- 이 뒤로 생기는 NULL 은 «회사가 직인을 안 올렸다»라는 뜻이고, 그때는 문구가 맞다.
--
-- 직인을 아직 안 올린 워크스페이스에서는 아무 일도 안 일어난다(넣을 그림이 없다).
--
-- 보안 (LOOP.md 7절 S1)
--   표를 만들지 않는다. crm_quote 는 칼럼 갱신, crm_quote_asset 은 271 이 같은 판에서
--   RLS 를 켜고 anon·authenticated 권한을 회수해 둔 표다(이번에도 권한 0건 확인).
--
-- 되돌리기 (이 판만 되돌림 — 274 의 칼럼은 남는다):
--   UPDATE crm_quote SET "sealAssetHash" = NULL
--   WHERE "sealAssetHash" = (그때 넣은 해시);

-- ── 1 지금 설정에 있는 직인을 자산으로 ──────────────────────
INSERT INTO crm_quote_asset (hash, "dataUri")
SELECT encode(sha256(convert_to(s."valueJson" #>> '{}', 'UTF8')), 'hex'),
       s."valueJson" #>> '{}'
FROM crm_app_setting s
WHERE s.key = 'quote.supplier.seal'
  AND coalesce(s."valueJson" #>> '{}', '') <> ''
ON CONFLICT (hash) DO NOTHING;

-- ── 2 비어 있는 견적에 그 해시를 ────────────────────────────
-- 워크스페이스마다 자기 설정의 직인을 가리킨다(WORKSPACE 가 GLOBAL 을 덮는 기존 규칙)
UPDATE crm_quote q
SET "sealAssetHash" = s.seal_hash
FROM (
  SELECT q2.id, encode(sha256(convert_to(cfg."valueJson" #>> '{}', 'UTF8')), 'hex') AS seal_hash
  FROM crm_quote q2
  CROSS JOIN LATERAL (
    SELECT DISTINCT ON (a.key) a."valueJson"
    FROM crm_app_setting a
    WHERE a.key = 'quote.supplier.seal'
      AND (a.scope = 'GLOBAL' OR a."workspaceId" = q2."workspaceId")
      AND coalesce(a."valueJson" #>> '{}', '') <> ''
    ORDER BY a.key, (a.scope = 'WORKSPACE') DESC
  ) cfg
  WHERE q2."sealAssetHash" IS NULL
) s
WHERE q.id = s.id;
