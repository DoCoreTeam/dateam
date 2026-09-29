-- 293 거래처·고객·딜의 담당자 칸을 작성자로 채운다
--
-- ## 무엇이 고장났나
--   v0.10.431·v0.10.433 이 세 목록과 오늘 화면의 **기본 범위를 「내 담당」으로 좁혔다.**
--   그런데 담당자 칸이 한 줄도 안 차 있었다 (실측 2026-09-29):
--
--     거래처 382건 중 담당자 0건 · 고객 209건 중 0건 · 딜 9건 중 0건
--
--   기본이 「내 담당」인데 내 담당인 행이 0건이니 **네 화면이 전부 빈 채로 열린다.**
--   데이터는 그대로 있는데 화면이 아무것도 못 보여 주는 상태다.
--   좁히는 판(v0.10.431)과 채우는 판이 갈려 있었고, 채우는 쪽이 안 왔다.
--
-- ## 규칙: 쓴 사람이 기본 담당자다
--   사용자 지시 2026-09-29: *"내가 쓴거니깐 내가 담당이라는거야 다른 사람이 썼으면
--   다른 사람이 일단 디폴트로는 담당이지 왜냐면 이건 기능 만들기 전에 작성한거니깐"*
--
--   그래서 「소유자에게 전부 몰아준다」가 아니다. **행마다 그 행을 쓴 사람을 찾는다.**
--   지금 이 판에서는 활성 멤버가 한 명뿐이라 결과가 같지만, 규칙이 같지 않으면
--   멤버가 둘이 되는 날 남의 행이 소유자에게 넘어간다.
--
--   찾는 순서 셋, 위에서 걸리면 아래로 안 간다:
--     1 작성자 칸(`createdById`)이 차 있으면 그 사람
--     2 비어 있으면 감사 기록의 최초 `*.created` actor (거래처 10 · 고객 9 · 딜 9건)
--     3 둘 다 없으면 워크스페이스 소유자
--
--   3단계에 해당하는 행이 576건이다. 이 행들은 작성자 칸이 생기기(마이그 278) 전에,
--   감사 기록이 붙기 전에 들어왔다. **누가 썼는지 물을 자리가 처음부터 없었다.**
--   사용자가 전부 자기가 넣었다고 말했고(같은 지시), 뒷받침도 있다:
--     · 활성 CRM 멤버가 `mb_owner`(김도현) 한 명뿐이다 (다른 하나는 2026-08-16 삭제된 테스트계정)
--     · 감사 기록 2,405건의 actor 가 `mb_owner` 하나뿐이다 (3건은 actor 가 빔)
--
-- ## 담당자는 채우고 작성자는 안 채운다
--   3단계에서 `createdById` 는 **건드리지 않는다.** 둘은 성격이 다르다:
--     · 담당자는 **배정**이다. 바뀌는 값이고 기본값을 줘도 된다. 화면이 이 칸으로 거른다
--     · 작성자는 **기록**이다. 안 바뀌는 값이라 추정으로 채우면 그날부터 근거가 못 된다
--   마이그 278 이 작성자를 안 채우고 비워 둔 판단은 그대로 둔다. 화면은 빈 작성자를
--   「기록 없음」으로 그린다. 2단계에서만 기록이 있으므로 작성자도 같이 채운다.
--
-- ## 왜 표를 넷이 아니라 셋만 건드리나
--   `crm_quote` 에도 담당자 칸이 있고 4건 다 비어 있지만 **범위 필터가 안 읽는다.**
--   견적은 담당자가 비면 만든 사람을 담당으로 보는 길이 따로 있다
--   (lib/crm/services/quote.ts:174). 안 고장난 것은 안 건드린다.
--
-- ## 앞으로 또 비지 않나
--   안 빈다. 새로 만들면 만든 사람이 담당자로 붙는다.
--   company.ts:162 · person.ts:161 · deal.ts:396 의 `if (data.ownerId == null) data.ownerId = actorId`.
--   이 판은 **그 배선이 생기기 전에 들어온 행들**만 메운다.
--
-- ## 삭제된 멤버는 담당자로 안 쓴다
--   범위 필터가 활성 멤버만 본다. 삭제된 멤버를 담당자로 박으면 그 행은 아무에게도 안 보인다.
--   1·2단계는 멤버가 살아 있을 때만 걸고, 안 걸리면 3단계로 내려간다.
--
-- ## 삭제된 행도 채운다
--   되살리면 담당자 없는 행이 다시 생겨 같은 증상이 재발한다. 지금 같이 메운다.
--
-- ## 보안 (LOOP.md 7절)
--   세 질문 전부 「아니오」다. 새 표도 새 칸도 없고(칸은 278 이 이미 만듦),
--   새 창구도 안 열고, 밖에서 온 값도 안 다룬다. 이미 있는 칸의 값만 채운다.
--   RLS 는 행 단위라 값이 바뀌어도 잠금이 안 바뀐다. 세 표 모두 RLS 켜짐·강제이고
--   anon 권한이 없다. 정책 대상도 안 건드린다.
--
-- 되돌리기 (이 판 직전 세 표의 담당자는 383·211·10건 전부 비어 있었다):
--   UPDATE public.crm_company SET "ownerId" = NULL WHERE "createdAt" < '2026-09-29';
--   UPDATE public.crm_person  SET "ownerId" = NULL WHERE "createdAt" < '2026-09-29';
--   UPDATE public.crm_deal    SET "ownerId" = NULL WHERE "createdAt" < '2026-09-29';
--   (2단계가 채운 작성자까지 되돌리려면 마이그 278 을 다시 돌리면 같은 값이 나온다)

BEGIN;

-- ── 1단계: 작성자 칸이 찬 행은 그 사람이 담당자 ─────────────
UPDATE public.crm_company c SET "ownerId" = c."createdById"
FROM public.crm_member m
WHERE c."ownerId" IS NULL AND c."createdById" IS NOT NULL
  AND m.id = c."createdById" AND m."deletedAt" IS NULL;

UPDATE public.crm_person p SET "ownerId" = p."createdById"
FROM public.crm_member m
WHERE p."ownerId" IS NULL AND p."createdById" IS NOT NULL
  AND m.id = p."createdById" AND m."deletedAt" IS NULL;

UPDATE public.crm_deal d SET "ownerId" = d."createdById"
FROM public.crm_member m
WHERE d."ownerId" IS NULL AND d."createdById" IS NOT NULL
  AND m.id = d."createdById" AND m."deletedAt" IS NULL;

-- ── 2단계: 감사 기록에 최초 작성 actor 가 남은 행 ───────────
-- 같은 대상에 created 가 두 줄이면 가장 이른 것을 쓴다 (마이그 278 과 같은 규칙)
WITH first_created AS (
  SELECT DISTINCT ON (l."targetId") l."targetId" AS tid, l."actorId" AS aid
  FROM public.crm_audit_log l
  WHERE l.action = 'company.created' AND l."actorId" IS NOT NULL
  ORDER BY l."targetId", l."createdAt" ASC
)
UPDATE public.crm_company c
SET "ownerId" = f.aid, "createdById" = COALESCE(c."createdById", f.aid)
FROM first_created f
JOIN public.crm_member m ON m.id = f.aid AND m."deletedAt" IS NULL
WHERE c.id = f.tid AND c."ownerId" IS NULL;

WITH first_created AS (
  SELECT DISTINCT ON (l."targetId") l."targetId" AS tid, l."actorId" AS aid
  FROM public.crm_audit_log l
  WHERE l.action = 'person.created' AND l."actorId" IS NOT NULL
  ORDER BY l."targetId", l."createdAt" ASC
)
UPDATE public.crm_person p
SET "ownerId" = f.aid, "createdById" = COALESCE(p."createdById", f.aid)
FROM first_created f
JOIN public.crm_member m ON m.id = f.aid AND m."deletedAt" IS NULL
WHERE p.id = f.tid AND p."ownerId" IS NULL;

WITH first_created AS (
  SELECT DISTINCT ON (l."targetId") l."targetId" AS tid, l."actorId" AS aid
  FROM public.crm_audit_log l
  WHERE l.action = 'deal.created' AND l."actorId" IS NOT NULL
  ORDER BY l."targetId", l."createdAt" ASC
)
UPDATE public.crm_deal d
SET "ownerId" = f.aid, "createdById" = COALESCE(d."createdById", f.aid)
FROM first_created f
JOIN public.crm_member m ON m.id = f.aid AND m."deletedAt" IS NULL
WHERE d.id = f.tid AND d."ownerId" IS NULL;

-- ── 3단계: 기록이 아무 데도 없는 행은 워크스페이스 소유자 ───
-- 작성자 칸은 여기서 안 채운다. 담당자는 배정이고 작성자는 기록이다
UPDATE public.crm_company c SET "ownerId" = m.id
FROM public.crm_member m
WHERE c."ownerId" IS NULL
  AND m."workspaceId" = c."workspaceId" AND m.role = 'OWNER' AND m."deletedAt" IS NULL;

UPDATE public.crm_person p SET "ownerId" = m.id
FROM public.crm_member m
WHERE p."ownerId" IS NULL
  AND m."workspaceId" = p."workspaceId" AND m.role = 'OWNER' AND m."deletedAt" IS NULL;

UPDATE public.crm_deal d SET "ownerId" = m.id
FROM public.crm_member m
WHERE d."ownerId" IS NULL
  AND m."workspaceId" = d."workspaceId" AND m.role = 'OWNER' AND m."deletedAt" IS NULL;

COMMIT;
