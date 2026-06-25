-- 135_calendar_tz_backfill.sql
-- 캘린더 일정 시간대 +9h 오염 보정 (datetime SSOT 도입 동반 1회성 데이터 교정).
--
-- 배경: EventModal / Gemini 추천이 오프셋 없는 naive 문자열('YYYY-MM-DDTHH:MM:00')로 저장 →
--       Supabase(UTC) timestamptz가 UTC로 적재 → 표시 시 KST(+9h) 변환으로 9시간 부풀려짐.
--       (사용자 13:00 입력 → 22:00 표시)
--
-- 판별자(안전 경계): source + link_kind 컬럼.
--   - source='user' & link_kind IS NULL (EventModal 직접 입력)  → 오염(naive)  → 보정 대상
--   - source='ai'   & link_kind≠'meeting' (Gemini 일정추천)      → 오염(naive)  → 보정 대상
--   - source='rule' (일일 일정연동, 클라이언트 toISOString)        → 정상 UTC → 불변
--   - link_kind='meeting' (회의 앵커 source='user' / AI파생 source='ai')
--       → **정상 UTC** (앵커=MeetingEditor toISOString, AI파생=toStartAt '+09:00'). **절대 보정 금지** ← DC-REV CRITICAL
--
-- 교정: 오염행의 start_at/end_at 을 -9h. (시각·종일 일정 모두 균일 — 표시/그룹핑이 이제 KST 변환(kstDateKey)
--       을 거치므로 종일 일정도 -9h 후 KST 날짜가 보존됨.)
--
-- ⚠️ 멱등성: 이 마이그레이션은 schema_migrations로 1회만 적용 추적된다. 재적용 금지(중복 -9h 발생).
--    적용 직후 신규 코드(+09:00 앵커 저장)를 배포해야 한다.

BEGIN;

-- 보정 전 영향 행 수를 link_kind별로 로그(검증 + 회의앵커 오교정 방지 진단)
DO $$
DECLARE
  n_target integer;
  n_meeting_excluded integer;
BEGIN
  SELECT count(*) INTO n_target FROM calendar_events
    WHERE source IN ('user','ai') AND link_kind IS DISTINCT FROM 'meeting';
  SELECT count(*) INTO n_meeting_excluded FROM calendar_events
    WHERE source IN ('user','ai') AND link_kind = 'meeting';
  RAISE NOTICE '[135] 보정대상(오염) % 행 / 제외(회의앵커=정상UTC) % 행', n_target, n_meeting_excluded;
END $$;

UPDATE calendar_events
SET
  start_at = start_at - interval '9 hours',
  end_at   = CASE WHEN end_at IS NOT NULL THEN end_at - interval '9 hours' ELSE NULL END,
  updated_at = now()
WHERE source IN ('user', 'ai')
  AND link_kind IS DISTINCT FROM 'meeting';   -- 회의 앵커(정상 UTC) 제외 — DC-REV CRITICAL

COMMIT;
