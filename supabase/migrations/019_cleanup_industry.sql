-- 오염된 industry 값 정리
-- "Fit N" 또는 숫자만 있는 industry 값을 NULL로 초기화

UPDATE accounts
SET industry = NULL
WHERE industry ~ '^Fit\s+\d+$'
   OR industry ~ '^\d+$';
