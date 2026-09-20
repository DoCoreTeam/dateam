-- 265_admin_audit_and_auth_attempts.sql — 관리자 행위와 로그인 실패를 남긴다
--
-- 배경(실측 2026-09-20)
--   감사 장치는 **이미 다 있었다.** fn_audit 는 어느 표에나 붙는 범용 트리거고,
--   붙어 있는 여섯 표는 「누가 했는지」 채움률이 100% 다(주간보고 308/308 · 일일 250/250).
--   그런데 **구성원 표(profiles)만 거기에 안 물려 있었다.**
--   그래서 역할 변경·계정 삭제·비밀번호 초기화·2단계 해제가 아무 데도 안 남았다.
--
--   로그인도 같다. Supabase 가 남기는 auth.audit_log_entries 는 **0행**이라
--   비밀번호를 몇 번 틀렸는지 우리는 모른다.
--
-- 여기서 하는 일 셋
--   ① profiles 에 범용 감사 트리거를 붙인다 (다른 여섯 표와 같은 방식)
--   ② activity_log 의 module 목록에 admin_users·auth 를 더한다
--   ③ 로그인 실패를 셀 자리를 연다 (public_request_throttle 재사용, 새 표 없음)
--
-- ⚠️ ①만으로는 「누가」가 안 남는다. 구성원 관리는 **남의 계정을 고치는 일**이라
--    서비스 권한으로 쓰고, 그 경로에는 auth.uid() 가 없기 때문이다.
--    그래서 앱이 activity_log 에 행위자와 **의도**를 따로 적는다(②).
--    트리거는 「무엇이 바뀌었나」를, 앱 기록은 「누가 왜」를 맡는다.

-- ─────────────────────────────────────────────────────────────
-- ① 구성원 표를 감사 장치에 물린다
--
-- fn_audit 는 실패해도 원래 저장을 롤백하지 않게 만들어져 있다(146).
-- 그래서 붙여도 로그인·가입이 위험해지지 않는다.
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit ON public.profiles;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- ─────────────────────────────────────────────────────────────
-- ② 앱이 적을 수 있게 module 목록을 넓힌다
--
-- 지금은 daily·dept_task 둘만 허용이라 관리자 행위를 적으면 제약에 걸려 죽는다.
-- 목록을 넓히되 여전히 목록이다 — 아무 값이나 들어오면 나중에 무엇을 세는지 알 수 없다.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_module_check;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_module_check
  CHECK (module = ANY (ARRAY['daily', 'dept_task', 'admin_users', 'auth']));

COMMENT ON COLUMN public.activity_log.module IS
  'daily·dept_task 는 업무 활동. admin_users 는 관리자의 구성원 조작(역할·삭제·비밀번호·2단계·퇴사·초대). auth 는 로그인 시도.';

-- 관리자 기록과 로그인 기록을 시간순으로 꺼낼 때 쓴다
CREATE INDEX IF NOT EXISTS activity_log_module_occurred_idx
  ON public.activity_log (module, occurred_at DESC);

-- ─────────────────────────────────────────────────────────────
-- ③ 관리자 기록은 관리자만 읽는다
--
-- 기존 select 정책이 본인 것만 보여 주는 형태라, 관리자 행위 기록은
-- 대상이 된 사람에게도 보이면 곤란하고(퇴사 예정 같은 것) 남에게도 보이면 안 된다.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS activity_log_admin_module_select ON public.activity_log;
CREATE POLICY activity_log_admin_module_select ON public.activity_log
  FOR SELECT TO authenticated
  USING (
    module NOT IN ('admin_users', 'auth')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.deleted_at IS NULL
    )
  );

-- ─────────────────────────────────────────────────────────────
-- ④ 관리자에게 2단계를 요구하는 설정값 자리
--
-- 읽는 코드(lib/auth/mfa.ts)는 이미 있는데 값을 켤 자리가 없었다.
-- 기본은 꺼짐 — 켜는 것은 사람의 결정이다.
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('mfa_required_for_admin', 'false')
ON CONFLICT (key) DO NOTHING;
