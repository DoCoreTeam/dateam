-- 209_ci_content_media.sql — 영상 실체 이해 저장소
--
-- 왜 이 표가 필요한가:
-- 지금까지 CI가 콘텐츠에 대해 아는 것은 **플랫폼이 알려준 것**이 전부였다(제목·설명·태그).
-- 숏폼은 플랫폼이 알려주는 것이 거의 없다 — 실측 ci_contents 숏폼 423건 중 227건이 설명문 없음,
-- 키워드는 전 건 0개. 그래서 화면이 "설명문을 확보하지 못했습니다"라고 말했고,
-- 주제 분류·크리에이티브 분석이 전부 같은 빈 상자를 보며 굶었다.
--
-- 이 표는 **영상 안에서 관측된 것**을 담는다. 대사·화면 자막·구간 전개·연출.
-- 플랫폼이 준 것이 아니라 영상이 준 것이므로, 분류 사다리에 **새로운 종류의 증거**가 된다.
--
-- 관계: ci_contents 1:1 소유(owns) — 게시물이 사라지면 그 영상 이해도 존재 이유가 없다.
--       (관계·삭제 계약 정책 R-1: 남겨서 사용자가 얻는 것이 없으면 소유다)

CREATE TABLE IF NOT EXISTS ci_content_media (
  content_id           uuid PRIMARY KEY REFERENCES ci_contents(id) ON DELETE CASCADE,
  workspace_id         uuid NOT NULL REFERENCES ci_workspaces(id) ON DELETE CASCADE,

  -- ── 말과 글 ── 영상에서만 얻을 수 있고, 검색·인용의 대상이 된다
  transcript           text,
  on_screen_text       text[] NOT NULL DEFAULT '{}',

  -- ── 구조 ── 편집점 화면이 쓸 타임라인
  beats                jsonb  NOT NULL DEFAULT '[]',
  hook_device          text,
  hook_message         text,
  ending               text,

  -- ── 연출 ── 우리가 따라 만들 때의 제작 스펙
  cut_count            integer,
  pacing               text,
  shot_types           text[] NOT NULL DEFAULT '{}',
  aspect               text,
  has_subtitle         boolean,
  subtitle_style       text,
  audio_style          text,

  -- ── 상황 ──
  setting              text,
  people_count         integer,

  -- ── 판단 ── 기획으로 바로 넘어가는 것
  topic_guess          text,
  topic_evidence       text,
  why_it_works         text,
  replicable_formula   text,
  loopable             boolean,
  cta_present          boolean,

  -- ── 출처 ── 무엇으로 봤는지를 반드시 남긴다.
  -- 'remote_video'로 본 것과 'still_image'로 본 것은 신뢰도가 다르고,
  -- 화면이 그 차이를 말해야 사용자가 결과를 어디까지 믿을지 안다.
  access_method        text NOT NULL DEFAULT 'none',
  model                text,
  evidence             jsonb NOT NULL DEFAULT '{}',
  analyzed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ci_media_ws        ON ci_content_media (workspace_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_media_hook      ON ci_content_media (workspace_id, hook_device) WHERE hook_device IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ci_media_access    ON ci_content_media (workspace_id, access_method);

-- 대사 전문 검색. 한국어는 형태소 사전이 없으므로 'simple'로 토큰만 쪼갠다 —
-- 완전하지는 않지만 "이 표현을 쓴 영상"을 찾는 데는 충분하고, 없는 것보다 압도적으로 낫다.
CREATE INDEX IF NOT EXISTS idx_ci_media_transcript_fts
  ON ci_content_media USING gin (to_tsvector('simple', coalesce(transcript, '')));

ALTER TABLE ci_content_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_media_select ON ci_content_media;
CREATE POLICY ci_media_select ON ci_content_media
  FOR SELECT USING (ci_is_member(workspace_id));

COMMENT ON TABLE  ci_content_media IS
  '영상 실체에서 관측된 것. 플랫폼 메타(ci_contents)와 달리 영상을 실제로 보고 얻은 증거다.';
COMMENT ON COLUMN ci_content_media.access_method IS
  'remote_video=영상을 통째로 봄 / still_image=커버 이미지만 봄 / none=둘 다 못 봄. 신뢰도가 다르므로 화면이 구분해 말한다.';
COMMENT ON COLUMN ci_content_media.transcript IS
  '영상에서 들린 말 전체. 숏폼에는 설명문이 없어 이것이 사실상 유일한 본문이다.';
