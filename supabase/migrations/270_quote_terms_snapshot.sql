-- 270: 거래 조건을 견적에 **굳힌다** — 견적서는 만든 날의 문서다
--
-- 왜: 지금은 조건 본문을 읽을 때마다 살아 있는 값(crm_quote_term.body 또는
--   설정 quote.supplier.terms)을 따라간다. 그래서 관리자가 기본 거래 조건을 한 글자
--   고치면, **이미 보낸 견적서를 다시 열었을 때 조건이 바뀌어 있다**.
--   고객이 들고 있는 종이와 우리 화면이 다른 말을 하는 것이고, 그건 문서가 아니다.
--
-- 왜 칼럼인가
--   조건은 서너 줄이고 순서가 곧 인쇄 순서다. 연결 표로 두면 순서를 또 저장해야 하고
--   (231 이 termIds 를 배열로 둔 것과 같은 이유), 무엇보다 **굳힌 값은 원본이 지워져도
--   남아야** 한다. 조건 항목을 삭제한 뒤에도 그 견적서는 그대로 인쇄되어야 한다.
--
-- 왜 지금 백필까지 하나
--   칼럼만 더하고 비워 두면 「빈 스냅샷 = 조건 없음」과 「빈 스냅샷 = 아직 안 굳힘」을
--   구별할 수 없다. 읽는 쪽이 그 둘을 나누려면 또 다른 표시가 필요하고, 그 표시가
--   결국 이 백필과 같은 일을 늦게 하는 것이다. 한 판에서 끝낸다.
--
-- 보안 (LOOP.md 7절 S1)
--   **표를 만들지 않는다.** crm_quote 에 칼럼 하나를 더할 뿐이라 그 표에 이미 걸린
--   RLS 와 정책이 이 칼럼에도 그대로 적용된다 — 새로 켤 잠금도, 사본도 없다.
--   anon 에게 주는 권한이 없고(GRANT 문 없음), 새로 저장하는 값은 이미 같은 견적을
--   볼 수 있는 사람에게 인쇄되어 나가던 문장이라 노출 범위가 안 넓어진다.
--
-- 되돌리기:
--   ALTER TABLE crm_quote DROP COLUMN IF EXISTS "termsSnapshot";
--   (칼럼만 지우면 읽는 쪽이 예전처럼 살아 있는 조건을 따라간다)

ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "termsSnapshot" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN crm_quote."termsSnapshot" IS
  '이 견적서에 인쇄될 거래 조건을 만든 날 그대로 굳힌 것. 순서가 곧 인쇄 순서다';

-- ── 백필 1: 조건을 고른 견적 ────────────────────────────────
-- **고른 순서 그대로** 굳힌다. DB 가 주는 순서가 아니라 termIds 의 순서다
-- (화면·엑셀이 이미 그 순서로 인쇄한다).
UPDATE crm_quote q
SET "termsSnapshot" = s.bodies
FROM (
  SELECT q2.id,
         array_agg(t.body ORDER BY o.ord) AS bodies
  FROM crm_quote q2
  CROSS JOIN LATERAL unnest(q2."termIds") WITH ORDINALITY AS o(term_id, ord)
  JOIN crm_quote_term t ON t.id = o.term_id
  GROUP BY q2.id
) s
WHERE q.id = s.id
  AND cardinality(q."termsSnapshot") = 0;

-- ── 백필 2: 아무것도 안 고른 견적 ───────────────────────────
-- 설정의 기본 거래 조건을 줄 단위로 굳힌다. 읽는 쪽이 오늘 하는 일과 같다 —
-- 줄바꿈으로 나누고 빈 줄은 버린다(domain/quote-document).
-- WORKSPACE 설정이 GLOBAL 을 덮는다(설정 읽기의 기존 규칙).
UPDATE crm_quote q
SET "termsSnapshot" = s.bodies
FROM (
  SELECT q2.id,
         array_remove(array_agg(btrim(r.line) ORDER BY r.line_no), '') AS bodies
  FROM crm_quote q2
  CROSS JOIN LATERAL regexp_split_to_table(
    COALESCE(
      (SELECT ws."valueJson" #>> '{}' FROM crm_app_setting ws
        WHERE ws.key = 'quote.supplier.terms'
          AND ws.scope = 'WORKSPACE'
          AND ws."workspaceId" = q2."workspaceId"),
      (SELECT gl."valueJson" #>> '{}' FROM crm_app_setting gl
        WHERE gl.key = 'quote.supplier.terms'
          AND gl.scope = 'GLOBAL'
        LIMIT 1),
      ''
    ),
    E'\r?\n'
  ) WITH ORDINALITY AS r(line, line_no)
  WHERE cardinality(q2."termIds") = 0
  GROUP BY q2.id
) s
WHERE q.id = s.id
  AND cardinality(q."termsSnapshot") = 0;
