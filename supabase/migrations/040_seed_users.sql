-- =============================================================================
-- 040_seed_users.sql
-- 임직원 초기 데이터 마이그레이션 (사용자만, 부서 제외)
-- email: {prefix}@data-alliance.com  |  rank: 직위
-- 초기 비밀번호: RESET_SENTINEL (빈칸 로그인 → 첫 로그인 시 변경 강제)
-- 소장 → 이사,  총괄 → 부사장 변환 적용
-- 이메일 없는 인원(김민구·정준호·박영무)은 수동 추가 필요
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. auth.users INSERT (이미 존재하는 이메일은 WHERE NOT EXISTS로 skip)
--    handle_new_user 트리거가 profiles 행 자동 생성
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  id, instance_id,
  email, encrypted_password,
  email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  role, aud
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  u.email,
  crypt('AX_RESET_REQUIRED_2024!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  json_build_object('name', u.uname),
  now(), now(),
  'authenticated', 'authenticated'
FROM (VALUES
  -- presidents
  ('velojazz@data-alliance.com',    '이광범'),
  ('jhjeong@data-alliance.com',     '정진환'),
  -- 성장관리본부 [재무/회계/인사/총무]
  ('sue@data-alliance.com',         '임수연'),
  ('jyseo@data-alliance.com',       '서자영'),
  ('woody@data-alliance.com',       '정우재'),
  ('yclee98@data-alliance.com',     '이윤찬'),
  -- AX영업본부 [영업/기획/마케팅]
  ('michaelkim@data-alliance.com',  '김도현'),
  ('hum@data-alliance.com',         '김영은'),
  -- 전략사업본부 [SMARTCITY MSP 외]
  ('kty@data-alliance.com',         '김태용'),
  ('sungwoo.cho@data-alliance.com', '조성우'),
  ('thkim@data-alliance.com',       '김태형'),
  -- 운영본부 [GCUBE 외]
  ('js.park@data-alliance.com',     '박요선'),
  ('shjeon@data-alliance.com',      '전성호'),
  -- RnD 연구 개발 본부 [연구소]
  ('sbison@data-alliance.com',      '노성수'),
  ('jykoo@data-alliance.com',       '구지연'),
  ('chaeyoon08@data-alliance.com',  '임채윤'),
  -- RnD 연구 개발 본부 [플랫폼/서비스/데이터 개발]
  ('dh.ahn@data-alliance.com',      '안두호'),
  ('bjk@data-alliance.com',         '권봉재'),
  ('kittenjun@data-alliance.com',   '권상준'),
  ('ress@data-alliance.com',        '조광현'),
  ('kkssgg@data-alliance.com',      '김성구'),
  ('hobbangc@data-alliance.com',    '장호진'),
  ('hspark@data-alliance.com',      '박현숙'),
  ('yj.oh@data-alliance.com',       '오유정')
) AS u(email, uname)
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.email = u.email
);

-- ---------------------------------------------------------------------------
-- 2. profiles 업데이트: name + rank + must_change_password
--    신규/기존 모두 적용 (HR 공식 데이터로 덮어쓰기)
-- ---------------------------------------------------------------------------
-- must_change_password: 이미 FALSE(완료)인 사용자는 절대 덮어쓰지 않음
UPDATE profiles p
SET
  name                 = u.uname,
  rank                 = u.urank,
  must_change_password = CASE WHEN p.must_change_password IS DISTINCT FROM FALSE THEN TRUE ELSE FALSE END,
  updated_at           = now()
FROM (VALUES
  ('velojazz@data-alliance.com',    '이광범', 'CEO'),
  ('jhjeong@data-alliance.com',     '정진환', 'CTO'),
  ('sue@data-alliance.com',         '임수연', '이사'),
  ('jyseo@data-alliance.com',       '서자영', '실장'),
  ('woody@data-alliance.com',       '정우재', '부장'),
  ('yclee98@data-alliance.com',     '이윤찬', NULL),
  ('michaelkim@data-alliance.com',  '김도현', '상무'),
  ('hum@data-alliance.com',         '김영은', '부장'),
  ('kty@data-alliance.com',         '김태용', '이사'),
  ('sungwoo.cho@data-alliance.com', '조성우', '이사'),
  ('thkim@data-alliance.com',       '김태형', '실장'),
  ('js.park@data-alliance.com',     '박요선', '수석'),
  ('shjeon@data-alliance.com',      '전성호', '과장'),
  ('sbison@data-alliance.com',      '노성수', '이사'),
  ('jykoo@data-alliance.com',       '구지연', '주임'),
  ('chaeyoon08@data-alliance.com',  '임채윤', '연구원'),
  ('dh.ahn@data-alliance.com',      '안두호', '이사'),
  ('bjk@data-alliance.com',         '권봉재', '실장'),
  ('kittenjun@data-alliance.com',   '권상준', '수석'),
  ('ress@data-alliance.com',        '조광현', '실장'),
  ('kkssgg@data-alliance.com',      '김성구', '책임'),
  ('hobbangc@data-alliance.com',    '장호진', '선임'),
  ('hspark@data-alliance.com',      '박현숙', '선임'),
  ('yj.oh@data-alliance.com',       '오유정', '연구원')
) AS u(email, uname, urank)
JOIN auth.users au ON au.email = u.email
WHERE p.id = au.id;

-- ---------------------------------------------------------------------------
-- NOTE: 이메일 없어 제외된 인원 (관리자가 수동 추가 필요)
--   김민구  부사장  (이메일 미확인)
--   정준호  이사    (이메일 미확인)
--   박영무  수석    (이메일 미확인)
-- ---------------------------------------------------------------------------
