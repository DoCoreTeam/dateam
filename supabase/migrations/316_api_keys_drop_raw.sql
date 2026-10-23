-- 316 API 키 원문 칼럼 제거
-- 키 원문을 해시와 나란히 평문으로 보관하고 있었다(감사 2026-10-23)
-- DB 를 읽을 수 있는 사람이나 서비스롤 유출 한 번이면 모든 키를 그대로 쓸 수 있다
-- 인증은 key_hash 만 본다(lib/publicApiAuth.ts), 원문은 만들 때 응답으로 한 번만 준다
-- 되돌릴 수 없다: 지워진 원문은 다시 못 만든다, 키 자체는 해시로 계속 통한다

alter table public.api_keys drop column if exists raw_key;
