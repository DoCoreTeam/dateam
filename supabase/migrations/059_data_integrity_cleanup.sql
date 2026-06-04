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

CREATE OR REPLACE FUNCTION public.infer_tier(m text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE s text := lower(trim(m));
BEGIN
  -- Tier 1: 데이터센터 플래그십
  IF s ~ '(h100|h200|h800|b100|b200|b300|gb200|gb300|a100|a800|mi300|mi325|gaudi)' THEN RETURN 1; END IF;
  -- Tier 2: 워크스테이션/추론급
  IF s ~ '(l40s|l40|l4|a40|a30|a10|a16|v100|t4|rtx pro 6000|rtx 6000 ada|rtx 5000 ada|rtx a6000|rtx a5000|rtx a5500)' THEN RETURN 2; END IF;
  -- Tier 3: 소비자 RTX 지포스 (20·30·40·50 시리즈), GTX
  IF s ~ 'rtx\s*[2345]0[0-9]0' THEN RETURN 3; END IF;
  IF s ~ '(gtx|geforce)' THEN RETURN 3; END IF;
  -- 그 외: 안전하게 Tier 2
  RETURN 2;
END $$;
