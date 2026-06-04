-- 059: GPU 데이터 정합성 전수 정리 (2026-06-04)
-- 배경: 통합입력 확정 모델 오매칭(v0.6.73 수정) 조사 중 대규모 메타데이터 오염 발견.
--   - 유령 product 206건(가격/참조 0건) — 카탈로그 오염
--   - 동일 모델·메모리·구성 중복 product 11쌍(tier만 다름)
--   - tier 오배정 61건(T4·V100·L4가 Tier1, 소비자 RTX가 Tier1/2)
--
-- 수행(운영 DB 1회 적용 완료, 트랜잭션):
--   1) 유령 product 206건 삭제 (가격 참조 0 → 손실 0)
--   2) 중복 11쌍 병합 (가격 참조를 survivor로 재연결 후 loser 삭제, 충돌 견적 8건 dedup)
--   3) 전 product tier = infer_tier(model_name) 교정 (133건 무결)
-- 검증 4중: tier불일치 0 / FK고아 0 / 가격SSOT(확정106건·RTX6000Ada 7견적) 보존 / 중복 0 + 브라우저 Tier1 정상
--
-- 본 파일은 재현용으로 infer_tier() 함수만 영속화(데이터 삭제는 1회성이라 미포함).
-- 함수는 tier-dict.ts와 동일 규칙 — 향후 tier 자동교정/감사에 사용.

-- 택소노미: 데이터센터=T1 / 워크스테이션=T2 / 소비자=T3 (데이터센터/클라우드 GPU는 기본 T1)
CREATE OR REPLACE FUNCTION public.infer_tier(m text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE s text := lower(trim(m));
BEGIN
  -- 1) 워크스테이션 RTX/Quadro (Ada·A시리즈·PRO·Quadro) → T2 (소비자보다 먼저)
  IF s ~ '(rtx pro|rtx a[0-9]|rtx [0-9]+ ada|quadro)' OR s ~ '\y(a6000|a5000|a5500|a4000|a4500|a2000)\y' THEN RETURN 2; END IF;
  -- 2) 소비자 지포스 (RTX 2060~5090 비-Ada, GTX) → T3
  IF s ~ 'rtx\s*[2345]0[0-9]0' OR s ~ '\y(gtx|geforce)\y' THEN RETURN 3; END IF;
  -- 3) 데이터센터/클라우드 + 미지 → T1 (기본)
  RETURN 1;
END $$;
