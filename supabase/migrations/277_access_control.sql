-- 277: 접근권한을 담을 자리 — 표면 등재부와 부여 기록
--
-- 왜: 지금 «누가 어느 메뉴를 보는가»가 코드 세 곳에 흩어져 있고(NAV_AUDIENCE ·
--   ADMIN_ONLY_GROUPS · 각 라우트의 requireAdmin), 관리자가 화면에서 여닫을 방법이 없다.
--   화면을 하나 더 열어 주려면 사람이 코드를 고치고 배포해야 한다.
--
-- 왜 표가 둘인가
--   · access_surface — **무엇이 있는가**. 코드 등재부(apps/web/lib/access/surfaces.ts)의
--     사본이다. 부여가 모르는 표면을 가리키지 못하게 외래키를 걸 자리가 필요하고,
--     관리자 화면이 이름·묶음·기본값을 조인해서 그릴 자리가 필요하다.
--     **진실은 코드에 있고 여기는 사본이다** — 동기화는 코드에서 DB 로 한 방향뿐이다.
--     반대로 흐르면 화면을 지웠는데 표에는 남아 «없는 문»이 그려진다.
--   · access_grant — **누구에게 열어 주었는가**. 표면 하나에 주체 하나가 한 줄이다.
--
-- 왜 주체 종류가 둘인가 (사용자 · 조직)
--   기획에는 역할(role)도 있었다. 넣지 않는다 — 지금 판정 함수(lib/access/decide.ts)가
--   그 종류를 읽지 못한다. 읽지 못하는 값을 저장할 수 있게 두면 관리자가 역할로 열어 놓고
--   **아무 일도 안 일어나는 것**을 보게 된다. 조용한 무시가 제일 나쁘다.
--   역할이 필요해지면 판정 함수와 같은 판에서 CHECK 를 늘린다.
--   그리고 지금 역할이 할 수 있는 일은 이미 표면 기본값('all')이 한다.
--
-- 왜 하위 포함이 칼럼인가
--   조직에 열면 하위 부서도 열리는 것이 기본이다(본부에 열면 팀도 열림).
--   그런데 «본부만, 팀은 빼고»가 실제로 필요하다. 그것을 끄는 자리가 없으면
--   관리자는 팀마다 차단을 한 줄씩 넣어야 하고, 부서가 늘면 그 줄이 낡는다.
--
-- 왜 표면이 사라져도 부여를 지우지 않는가
--   외래키를 ON DELETE CASCADE 로 걸면 코드에서 표면 한 줄을 지우는 순간
--   관리자가 쌓아 둔 부여가 **조용히 사라진다**. 되돌릴 수 없다.
--   그래서 기본값(RESTRICT)으로 둔다 — 부여가 남은 표면은 지워지지 않고 오류가 난다.
--   동기화는 넣고 고치기만 하고 지우지 않는다.
--
-- 보안 (LOOP.md 7절 S1)
--   두 표 모두 같은 판에서 RLS 를 켜고(ENABLE + FORCE) anon·authenticated 권한을 회수한다.
--   정책은 **0개** = 서비스롤 밖에서는 아무도 못 읽고 못 쓴다. `TO public` 은 쓰지 않는다.
--   접근권한 표 자체를 사용자 키로 읽게 두면 «누가 무엇을 볼 수 있는가»가 새어 나가고,
--   쓰기가 되면 자기 자신에게 문을 열 수 있다. 읽기도 쓰기도 앱 서버(관리자 확인 뒤)만 한다.
--   264(ai_provider_keys)가 같은 이유로 같은 벽을 썼다.
--   사본(CREATE TABLE AS)은 만들지 않는다.
--
-- 기존 행은 하나도 안 바뀐다 — 새 표 둘만 만들고 기존 표는 참조만 한다.
--
-- 되돌리기:
--   DROP TABLE IF EXISTS public.access_grant;
--   DROP TABLE IF EXISTS public.access_surface;

-- ── 표면 등재부 (코드의 사본) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_surface (
  key               TEXT        PRIMARY KEY,
  -- 화면에 그릴 이름. 코드의 NAV_LABEL 에서 온다
  label             TEXT        NOT NULL,
  -- 사이드바 묶음 키. ADMIN_ONLY_GROUPS 가 키로 판정하므로 이름이 아니라 키다
  group_key         TEXT        NOT NULL,
  -- 들어가는 주소. 하위 경로는 전부 이 표면에 속한다
  href              TEXT        NOT NULL,
  -- 부여가 0건일 때의 답
  default_audience  TEXT        NOT NULL CHECK (default_audience IN ('all', 'admin')),
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.access_surface ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_surface FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.access_surface FROM PUBLIC;
REVOKE ALL ON public.access_surface FROM anon;
REVOKE ALL ON public.access_surface FROM authenticated;
GRANT  ALL ON public.access_surface TO service_role;

COMMENT ON TABLE public.access_surface IS
  '표면 등재부의 DB 사본. 진실은 apps/web/lib/access/surfaces.ts 에 있고 동기화는 코드→DB 한 방향이다';

-- ── 부여 기록 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_grant (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  surface_key         TEXT        NOT NULL REFERENCES public.access_surface(key),
  -- user 면 profiles.id, org 면 org_nodes.id. 종류가 둘이라 외래키는 못 걸고 앱이 대조한다
  subject_kind        TEXT        NOT NULL CHECK (subject_kind IN ('user', 'org')),
  subject_id          UUID        NOT NULL,
  -- 막음이 열기를 이긴다(판정 2단계)
  effect              TEXT        NOT NULL CHECK (effect IN ('allow', 'deny')),
  -- 조직 부여가 하위 부서로 내려가나. user 부여에는 뜻이 없다
  include_descendants BOOLEAN     NOT NULL DEFAULT true,
  created_by          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 같은 표면에 같은 주체가 두 줄이면 어느 쪽이 이기는지 사람이 알 수 없다
  UNIQUE (surface_key, subject_kind, subject_id)
);

-- 화면 한 번에 그 사람 부여를 전부 읽는다(요청당 1회). 주체로 먼저 좁힌다
CREATE INDEX IF NOT EXISTS idx_access_grant_subject
  ON public.access_grant (subject_kind, subject_id, surface_key);

ALTER TABLE public.access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_grant FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.access_grant FROM PUBLIC;
REVOKE ALL ON public.access_grant FROM anon;
REVOKE ALL ON public.access_grant FROM authenticated;
GRANT  ALL ON public.access_grant TO service_role;

COMMENT ON TABLE public.access_grant IS
  '표면 하나를 누구에게 열거나 막았는가. 0건이면 표면 기본값만 남고 화면은 지금과 같다';
COMMENT ON COLUMN public.access_grant.include_descendants IS
  '조직 부여가 하위 조직까지 내려가나. 본부에만 열고 팀은 빼려면 false';
