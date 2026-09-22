-- 278 거래처·고객 담당자·딜에 «등록한 사람» 칸을 만든다
--
-- 왜: 영업 CRM 의 여덟 표를 전수로 셌더니 **작성자 칸이 있는 표는 잘 채워지는데**
--   (활동 418/419 · 회의 10/10 · 첨부 47/47 · 견적 4/4 · 할일 14/14)
--   가장 큰 셋에는 칸 자체가 없었다 (거래처 381건 · 고객 담당자 209건 · 딜 8건, 실측 2026-09-22).
--   누가 넣었는지 물을 자리가 없으니, 잘못 들어온 행을 누구에게 물어야 하는지도 알 수 없다.
--
-- 담당자(ownerId)는 이미 세 표에 다 있다. 새로 만들지 않는다 — 다만 한 줄도 안 차 있고
--   그 칸을 읽는 앱 코드가 0곳이다. 채우는 일은 다음 항목이 한다.
--
-- ## 왜 외래키를 안 거나
--   이 저장소의 `createdById` 는 전부 외래키 없는 `TEXT` 다 (crm_quote·crm_task·crm_activity·
--   crm_meeting·crm_attachment 등 여덟 모델, prisma/schema.prisma 에 `String? // CrmMember.id`).
--   여기만 걸면 같은 뜻의 칸이 표마다 다른 규칙을 갖게 된다. 멤버는 소프트 삭제라
--   가리키는 대상이 사라지지도 않는다. **형과 규칙을 옆 표와 똑같이 맞춘다.**
--
-- ## 백필 — 기록에 있는 것만 넣는다
--   `crm_audit_log` 의 `company.created` · `person.created` · `deal.created` 에 actorId 가 있다.
--   그 행만 채운다. 나머지는 **비워 둔다.**
--   전부 김도현 상무가 만든 것이 사실상 확실하지만(감사 기록 1,638건의 actor 가 그 한 명뿐),
--   **확실한 것과 기록된 것은 다르다.** 추정으로 채우면 그 칸은 그날부터 근거가 못 된다.
--   화면은 빈 값을 「기록 없음」으로 그린다.
--   예상 건수: 거래처 10 · 고객 담당자 9 · 딜 9 (소프트 삭제 포함, 실측 2026-09-22)
--
-- ## 보안 (LOOP.md 7절 S1)
--   새 표를 만들지 않는다. 사본(CREATE TABLE AS)도 만들지 않는다.
--   세 표 모두 이미 RLS 가 켜져(ENABLE) 있고 강제(FORCE)이며 정책이 하나씩 있고
--   anon 에게 SELECT·INSERT 권한이 없다 (적용 직전 psql 실측).
--   칸을 더하는 것은 표의 잠금을 바꾸지 않는다 — 정책은 행 단위라 새 칸도 같은 정책을 탄다.
--   새 창구를 열지 않고 밖에서 온 값을 다루지도 않는다 (세 질문 중 1번만 «예»).
--
-- 되돌리기:
--   ALTER TABLE public.crm_company DROP COLUMN IF EXISTS "createdById";
--   ALTER TABLE public.crm_person  DROP COLUMN IF EXISTS "createdById";
--   ALTER TABLE public.crm_deal    DROP COLUMN IF EXISTS "createdById";

BEGIN;

-- ── 칸 셋 ──────────────────────────────────────────────────
ALTER TABLE public.crm_company ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE public.crm_person  ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE public.crm_deal    ADD COLUMN IF NOT EXISTS "createdById" TEXT;

COMMENT ON COLUMN public.crm_company."createdById" IS
  '등록한 사람(CrmMember.id). 바뀌지 않는다. 비어 있으면 기록이 없는 것이고 추정으로 채우지 않는다';
COMMENT ON COLUMN public.crm_person."createdById" IS
  '등록한 사람(CrmMember.id). 바뀌지 않는다. 비어 있으면 기록이 없는 것이고 추정으로 채우지 않는다';
COMMENT ON COLUMN public.crm_deal."createdById" IS
  '등록한 사람(CrmMember.id). 바뀌지 않는다. 비어 있으면 기록이 없는 것이고 추정으로 채우지 않는다';

-- ── 백필: 감사 기록에 actor 가 남아 있는 행만 ──────────────
-- 같은 대상에 created 가 두 줄이면 가장 이른 것을 쓴다 (처음 만든 사람이 작성자다)
WITH first_created AS (
  SELECT DISTINCT ON (l."targetId")
         l."targetId" AS target_id, l."actorId" AS actor_id
  FROM public.crm_audit_log l
  WHERE l.action = 'company.created' AND l."actorId" IS NOT NULL
  ORDER BY l."targetId", l."createdAt" ASC
)
UPDATE public.crm_company c
SET "createdById" = f.actor_id
FROM first_created f
WHERE c.id = f.target_id AND c."createdById" IS NULL;

WITH first_created AS (
  SELECT DISTINCT ON (l."targetId")
         l."targetId" AS target_id, l."actorId" AS actor_id
  FROM public.crm_audit_log l
  WHERE l.action = 'person.created' AND l."actorId" IS NOT NULL
  ORDER BY l."targetId", l."createdAt" ASC
)
UPDATE public.crm_person p
SET "createdById" = f.actor_id
FROM first_created f
WHERE p.id = f.target_id AND p."createdById" IS NULL;

WITH first_created AS (
  SELECT DISTINCT ON (l."targetId")
         l."targetId" AS target_id, l."actorId" AS actor_id
  FROM public.crm_audit_log l
  WHERE l.action = 'deal.created' AND l."actorId" IS NOT NULL
  ORDER BY l."targetId", l."createdAt" ASC
)
UPDATE public.crm_deal d
SET "createdById" = f.actor_id
FROM first_created f
WHERE d.id = f.target_id AND d."createdById" IS NULL;

-- ── 목록에서 «내가 만든 것»을 거를 자리 ────────────────────
-- 워크스페이스로 먼저 좁힌다. 담당자 색인(workspaceId, ownerId)과 같은 모양이다
CREATE INDEX IF NOT EXISTS idx_crm_company_created_by
  ON public.crm_company ("workspaceId", "createdById");
CREATE INDEX IF NOT EXISTS idx_crm_person_created_by
  ON public.crm_person ("workspaceId", "createdById");
CREATE INDEX IF NOT EXISTS idx_crm_deal_created_by
  ON public.crm_deal ("workspaceId", "createdById");

COMMIT;
