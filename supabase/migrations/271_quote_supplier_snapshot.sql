-- 271: 공급자 정보와 로고도 견적에 **굳힌다** — 스냅샷은 조건만이 아니다
--
-- 왜: 270 이 거래 조건을 굳혔지만, 상호·대표이사·주소·로고는 여전히 설정을 따라간다.
--   대표이사가 바뀌거나 로고를 새로 올리면 **이미 보낸 견적서를 다시 열었을 때
--   그 칸이 바뀌어 있다.** 고객이 든 종이와 우리 화면이 다른 말을 하면 그건 문서가 아니다
--   (사용자 지시 2026-09-20: 「그게 설령 로고나 회사명 대표이사가 바뀐거더라도
--   그때 당시의 유지가 핵심」).
--
-- 왜 로고는 따로 표인가
--   실측으로 로고가 97KB 짜리 data URI 다. 견적 행에 통째로 담으면 견적 천 건에 100MB 가
--   되고, 그 대부분은 **같은 그림의 복사본**이다. 내용 해시를 키로 두면 로고를 바꾸기 전까지
--   행이 하나다 — 견적은 그 해시만 가리킨다.
--
-- 왜 공급자는 jsonb 인가
--   일곱 값이 한 벌로 움직이고, 한 칸만 굳히는 일이 없다. 칼럼 여섯을 더하면 나중에
--   설정 항목이 하나 늘 때마다 또 마이그레이션이 필요하다.
--
-- 백필의 한계 (솔직히 적는다)
--   **그 견적이 만들어진 날의 공급자 값은 어디에도 남아 있지 않다.** 설정은 덮어쓰기라
--   이력이 없다. 그래서 기존 견적에는 오늘 값을 넣는다 — 틀릴 수 있지만 지금 화면이
--   보여 주는 값과 같고, 여기서부터는 안 바뀐다. 아무것도 안 넣으면 오늘 값을 계속
--   따라가므로 더 나쁘다.
--
-- 보안 (LOOP.md 7절 S1)
--   crm_quote 는 칼럼 추가라 기존 RLS 가 그대로 적용된다.
--   새 표 crm_quote_asset 은 **같은 판에서** RLS 를 켜고 anon·authenticated 권한을 회수한다
--   (231 이 crm_quote_term 에 한 것과 같은 벽). 정책은 두지 않는다 = 서비스롤 밖에서는
--   아무도 못 읽고 못 쓴다. 담는 것은 견적서에 이미 인쇄되어 나가던 우리 로고다.
--
-- 되돌리기:
--   ALTER TABLE crm_quote DROP COLUMN IF EXISTS "supplierSnapshot";
--   ALTER TABLE crm_quote DROP COLUMN IF EXISTS "logoAssetHash";
--   DROP TABLE IF EXISTS crm_quote_asset;

-- ── 굳힌 그림을 담는 자리 ────────────────────────────────────
-- 키가 내용의 해시다: 같은 로고를 백 번 굳혀도 행은 하나다
CREATE TABLE IF NOT EXISTS crm_quote_asset (
  hash        TEXT PRIMARY KEY,
  -- data URI 통째로. 문서는 이것을 그대로 <img src> 에 넣는다
  "dataUri"   TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE crm_quote_asset ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_quote_asset FROM anon, authenticated;

-- ── 견적이 가리키는 자리 ────────────────────────────────────
ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "supplierSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "logoAssetHash" TEXT;

COMMENT ON COLUMN crm_quote."supplierSnapshot" IS
  '견적서에 찍힌 공급자 값을 만든 날 그대로 굳힌 것(name·bizNo·ceo·address·bizType·bizItem·terms)';
COMMENT ON COLUMN crm_quote."logoAssetHash" IS
  '그날의 로고. crm_quote_asset.hash 를 가리킨다 — 설정의 로고가 바뀌어도 이 견적서는 안 바뀐다';

-- ── 백필 1: 오늘의 로고를 자산으로 ──────────────────────────
INSERT INTO crm_quote_asset (hash, "dataUri")
SELECT encode(sha256(convert_to(s."valueJson" #>> '{}', 'UTF8')), 'hex'),
       s."valueJson" #>> '{}'
FROM crm_app_setting s
WHERE s.key = 'quote.supplier.logo'
  AND coalesce(s."valueJson" #>> '{}', '') <> ''
  AND s.scope = 'WORKSPACE'
ON CONFLICT (hash) DO NOTHING;

-- ── 백필 2: 기존 견적에 오늘의 공급자 값과 로고 해시를 ──────
UPDATE crm_quote q
SET "supplierSnapshot" = s.fields,
    "logoAssetHash"    = s.logo_hash
FROM (
  SELECT q2.id,
         coalesce(
           jsonb_object_agg(
             replace(cfg.key, 'quote.supplier.', ''),
             cfg."valueJson" #>> '{}'
           ) FILTER (WHERE cfg.key <> 'quote.supplier.logo'),
           '{}'::jsonb
         ) AS fields,
         max(
           CASE WHEN cfg.key = 'quote.supplier.logo'
                 AND coalesce(cfg."valueJson" #>> '{}', '') <> ''
             THEN encode(sha256(convert_to(cfg."valueJson" #>> '{}', 'UTF8')), 'hex')
           END
         ) AS logo_hash
  FROM crm_quote q2
  CROSS JOIN LATERAL (
    -- WORKSPACE 가 GLOBAL 을 덮는다(설정 읽기의 기존 규칙)
    SELECT DISTINCT ON (a.key) a.key, a."valueJson"
    FROM crm_app_setting a
    WHERE a.key LIKE 'quote.supplier.%'
      AND (a.scope = 'GLOBAL' OR a."workspaceId" = q2."workspaceId")
    ORDER BY a.key, (a.scope = 'WORKSPACE') DESC
  ) cfg
  GROUP BY q2.id
) s
WHERE q.id = s.id
  AND q."supplierSnapshot" = '{}'::jsonb;
