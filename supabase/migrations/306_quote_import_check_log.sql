-- 306: 파일로 읽은 견적의 **대조 결과를 남긴다**
--
-- 대조 장치는 이미 있다. 줄마다 금액을 맞춰 보고 맨 아래 합계를 견준다.
-- 그런데 **그 결과가 아무 데도 안 남는다** — 화면에서 한 번 보이고 사라진다.
--
-- 그래서 「파일로 읽은 견적이 손 안 대고 맞는 비율」을 지금은 셀 수 없다.
-- 셀 수 없으면 읽기를 고쳐도 좋아졌는지 답할 수 없고, 나빠져도 모른다.
-- 실측 2026-10-06 의 사고(원본 34,980,000원이 17,503,200원으로 저장됨)도
-- 사람이 눈으로 발견한 것이지 지표가 알려 준 것이 아니다.
--
-- **한 줄에 한 건.** 사람이 「넣기」를 눌러 견적이 만들어지는 순간 한 행이 생긴다.
-- 줄마다 남기지 않는 이유: 세고 싶은 것은 「이 문서를 손 안 대고 썼나」이지
-- 「몇 번째 줄이 틀렸나」가 아니다. 뒤쪽은 그때그때 화면이 말한다.
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 예, **새 표다.** 그래서 같은 마이그레이션에서 RLS 를 켠다.
--      정책 대상에 TO public 을 쓰지 않는다. CREATE TABLE AS 사본이 아니라 CREATE TABLE 이다.
--      읽기는 **자기 워크스페이스의 기록만**, 쓰기는 **자기 명의로만**.
--      고치기·지우기 정책은 **두지 않는다** — 지표는 더해지기만 해야 믿을 수 있다.
--   ② 새 창구를 여나 — 아니오. 쓰는 것은 이미 사람 확인을 지난 견적 만들기 경로뿐이다.
--   ③ 밖에서 온 값을 다루나 — 세는 숫자뿐이다. 원문도 품목 이름도 안 담는다.
--      파일 이름만 담고, 그것은 이미 crm_quote.sourceFileName 에 있는 값이다.
--
-- **금액을 안 담는다.** 차액은 담되(지표에 필요하다) 단가·품목·고객은 안 담는다 —
-- 지표 표가 견적서의 사본이 되면 그 표를 지킬 이유가 하나 더 늘어난다.

CREATE TABLE IF NOT EXISTS quote_import_check (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  /* 어느 견적이 됐나. 견적이 지워져도 기록은 남는다 — 지표는 과거의 사실이다 */
  quote_id        text,
  /*
    누가 넣었나. **앱이 적는다** — 이 표를 쓰는 연결은 서비스 연결이라
    auth.uid() 가 NULL 이고, 기본값으로 두면 전부 비어 버린다.
  */
  actor_id        text,
  source_file     text,
  /* 읽은 줄 수와 그중 **아무 위험 신호도 없던** 줄 수 */
  lines_read      integer NOT NULL DEFAULT 0,
  lines_clean     integer NOT NULL DEFAULT 0,
  /* 합계 대조 판정 — match · mismatch · no_reference */
  total_verdict   text NOT NULL DEFAULT 'no_reference',
  /* 우리 − 문서. 대조할 합계가 없었으면 NULL */
  total_diff_minor bigint,
  /* 기간을 못 읽은 것 같다고 짚은 줄 수 — 이번 판에서 새로 세는 것 */
  duration_missing integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE quote_import_check IS
  '파일로 읽은 견적의 대조 결과 한 줄. 「손 안 대고 맞은 건 수 ÷ 읽은 건 수」를 세는 근거';

CREATE INDEX IF NOT EXISTS quote_import_check_ws_time
  ON quote_import_check (workspace_id, created_at DESC);

/*
  **RLS 를 같은 판에서 켠다.** 표를 만든 마이그레이션이 켜지 않으면 그 사이에 구멍이 생기고,
  그 구멍은 화면에서 아무 일도 안 일어나므로 아무도 모른다(2026-09-13 경보의 그 모양).
*/
ALTER TABLE quote_import_check ENABLE ROW LEVEL SECURITY;

/*
  읽기 — **자기 워크스페이스의 기록만.** TO public 을 쓰지 않는다.

  **이 저장소의 CRM 표가 쓰는 그 근거를 그대로 쓴다** — `current_setting('app.workspace_id')`.
  crm_quote 의 정책이 같은 모양이고(실측 2026-10-06), 여기만 다른 근거를 쓰면
  「어느 쪽이 맞는 테넌트 판정인가」가 둘이 되어 언젠가 갈린다.
  그 설정을 안 심은 연결(익명 키 포함)에서는 NULL 과 비교하게 되어 **한 행도 안 보인다.**
*/
DROP POLICY IF EXISTS quote_import_check_select ON quote_import_check;
CREATE POLICY quote_import_check_select ON quote_import_check
  FOR SELECT TO authenticated
  USING (workspace_id = current_setting('app.workspace_id', true));

/* 쓰기 — 같은 워크스페이스로만. 남의 워크스페이스에 지표를 심을 수 없다 */
DROP POLICY IF EXISTS quote_import_check_insert ON quote_import_check;
CREATE POLICY quote_import_check_insert ON quote_import_check
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

/*
  **고치기·지우기 정책은 없다.** 지표는 더해지기만 해야 믿을 수 있다 —
  고칠 수 있으면 「안 맞은 건」을 지워 비율을 올릴 수 있고, 그러면 그 숫자는 아무 말도 안 한다.
*/

/* 익명에게는 아무 권한도 주지 않는다. GRANT 를 안 쓰므로 기본값 그대로다 */
REVOKE ALL ON quote_import_check FROM anon;

/*
  ── 세는 법 ────────────────────────────────────────────────────────────────

  「파일로 읽은 견적이 손 안 대고 맞는 비율」 — **한 질의**다.
  손 안 대고 맞았다 = 합계가 맞고(match) 모든 줄에 위험 신호가 없었다(clean = read).

    SELECT
      count(*)                                                     AS 읽은건수,
      count(*) FILTER (WHERE total_verdict = 'match'
                         AND lines_clean = lines_read)             AS 손안대고맞은건수,
      round(100.0 * count(*) FILTER (WHERE total_verdict = 'match'
                         AND lines_clean = lines_read)
            / nullif(count(*), 0), 1)                              AS 비율,
      sum(duration_missing)                                        AS 기간못읽은줄
    FROM quote_import_check
    WHERE created_at >= now() - interval '30 days';
*/
