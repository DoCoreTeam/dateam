-- 132_competitor_aliases.sql
-- 경쟁사 회사 병합(캐노니컬+별칭) — 별칭 보존 컬럼.
-- 왜: 같은 회사가 표기 변형으로 중복(CLOUDV ↔ CLOUDV (Smileserv), Lambda ↔ Lambda Labs).
--   병합 시 흡수 회사의 이름/약칭을 캐노니컬의 aliases 에 보존 → 같은 표기 재유입 시 자동 흡수
--   (resolveCompetitorId SSOT 가 도메인 다음으로 정규화 이름/별칭 일치를 본다).
-- additive only — 기존 행/데이터 변경 없음(ADD COLUMN + 인덱스).

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

-- 별칭 배열 조회 가속(향후 alias 기반 해소 쿼리용). 존재 시 무시.
CREATE INDEX IF NOT EXISTS competitors_aliases_gin ON competitors USING gin (aliases);

COMMENT ON COLUMN competitors.aliases IS '병합으로 흡수된 다른 표기(회사명/약칭). resolveCompetitorId 가 도메인 다음으로 이 별칭 일치를 본다.';
