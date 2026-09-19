/**
 * 표를 만들면서 RLS 켜는 것을 잊지 못하게 한다
 *
 * **왜**: 2026-09-13 Supabase 보안 경보가 «표가 공개돼 있다» 고 알려 왔다.
 *   실측해 보니 여덟 표가 열려 있었고 그중 `lead_intakes_dup_backup_20260817` 은
 *   **이메일 1,002건·휴대폰 495건**이 들어 있는 리드 사본이었다. 읽기만 되는 것도
 *   아니었다 — 익명 키로 INSERT 가 201, DELETE 가 204 를 돌려줬다(실측).
 *
 *   여덟 중 다섯은 `CREATE TABLE ... AS SELECT` 로 만든 **백업 사본**이다.
 *   사본을 뜰 때는 원본의 RLS 가 따라오지 않는다. 그 사실을 아는 사람이
 *   그 자리에 없으면 그날로 구멍이 하나 생기고, 화면에서는 아무 일도 안 일어난다.
 *
 *   그래서 사람 기억이 아니라 여기서 막는다. 표를 만드는 줄이 마이그레이션에
 *   들어오는 순간, 같은 코퍼스 어딘가에 그 표를 켜는 줄이 없으면 실패한다.
 *
 * 검사 셋:
 *   1) 마이그레이션이 만든 public 표는 전부 RLS 를 켜는 줄을 갖는다
 *   2) `TO public` 에 `USING (true)` 인 읽기·전체 정책을 새로 만들지 않는다
 *   3) 규칙이 실제로 도는 대상이 있다 (마이그레이션을 못 찾으면 실패)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'supabase', 'migrations')

/**
 * RLS 를 켜지 않아도 되는 표.
 *
 * 여기 적는다는 것은 «이 표는 누가 읽어도 된다» 는 선언이다.
 * 지금은 비어 있다 — 비어 있는 것이 맞는 상태다.
 */
const RLS_EXEMPT = new Set<string>([])

/**
 * 259 이전에 만들어져 259 가 뒤늦게 켠 표.
 *
 * 만든 줄과 켜는 줄이 다른 마이그레이션에 있어도 통과해야 한다 —
 * 규칙이 보는 것은 «코퍼스 어딘가에 켜는 줄이 있는가» 지 같은 파일인가가 아니다.
 * 이 목록은 설명용이고 판정에는 쓰지 않는다.
 */
const LATE_ENABLED = [
  'ai_llm_calls',
  'ai_external_transfers',
  'lead_intakes_dup_backup_20260817',
  'ci_reclassify_backup_20260827',
  'ci_topic_rules_backup_20260827',
  '_bak_ci_channels_20260811',
  '_bak_ci_contents_ch_20260811',
  'crm_quote_section',
]

function readMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }))
}

/** 주석을 지운다 — 예시로 적어 둔 CREATE TABLE 이 진짜로 세지지 않게. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function tableName(raw: string): string {
  return raw.replace(/^public\./i, '').replace(/"/g, '').toLowerCase()
}

test('마이그레이션이 만든 public 표는 전부 RLS 를 켠다', () => {
  const migrations = readMigrations()
  assert.ok(migrations.length > 0, `마이그레이션을 못 찾았다: ${MIGRATIONS}`)

  const created = new Map<string, string>() // 표 이름 → 만든 파일
  const enabled = new Set<string>()

  for (const { name, sql } of migrations) {
    const body = stripComments(sql)

    // CREATE TABLE / CREATE TABLE IF NOT EXISTS / CREATE TABLE ... AS SELECT
    for (const m of body.matchAll(
      /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi,
    )) {
      const t = tableName(m[1])
      if (!created.has(t)) created.set(t, name)
    }

    // ⓐ 곧바로 쓴 것: ALTER TABLE x [FORCE] ENABLE ROW LEVEL SECURITY
    //    (사이에 다른 문장이 끼어드는 형태는 일부러 안 받는다 — 앞 표 이름을 잘못 집는다)
    for (const m of body.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s+(?:FORCE\s+)?ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
    )) {
      enabled.add(tableName(m[1]))
    }

    // ⓑ 반복문으로 켠 것: execute format('alter table %I enable row level security', t)
    //    표 이름이 array[...] 안에 문자열로 들어 있다 (247·248 이 이 모양이다)
    if (/alter\s+table\s+%I\s+enable\s+row\s+level\s+security/i.test(body)) {
      for (const arr of body.matchAll(/\barray\s*\[([^\]]*)\]/gi)) {
        for (const q of arr[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) enabled.add(q[1].toLowerCase())
      }
    }

    // DROP 된 표는 더 이상 대상이 아니다
    for (const m of body.matchAll(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi,
    )) {
      created.delete(tableName(m[1]))
    }
  }

  const missing = [...created.entries()]
    .filter(([t]) => !enabled.has(t) && !RLS_EXEMPT.has(t))
    .map(([t, from]) => `  ${t}  (${from})`)

  assert.equal(
    missing.length,
    0,
    `RLS 를 켜지 않은 표 ${missing.length}개\n${missing.join('\n')}\n\n` +
      `표를 만든 마이그레이션에 다음 줄을 더한다:\n` +
      `  ALTER TABLE public.<표이름> ENABLE ROW LEVEL SECURITY;\n` +
      `백업 사본도 예외가 아니다 — CREATE TABLE AS 는 원본의 RLS 를 가져오지 않는다.`,
  )
})

test('TO public 에 USING (true) 인 읽기·전체 정책을 새로 만들지 않는다', () => {
  const migrations = readMigrations()
  const offenders: string[] = []

  for (const { name, sql } of migrations) {
    // 259 가 그런 정책들을 걷어낸 판이다 — 걷어내는 쪽은 대상이 아니다
    if (name.startsWith('259_')) continue

    for (const m of stripComments(sql).matchAll(
      /CREATE\s+POLICY\s+("?[^\s"]+"?)[\s\S]{0,400}?;/gi,
    )) {
      const stmt = m[0]
      const forAll = /FOR\s+(SELECT|ALL)/i.test(stmt) || !/FOR\s+(INSERT|UPDATE|DELETE)/i.test(stmt)
      const toPublic = /TO\s+public\b/i.test(stmt)
      const usingTrue = /USING\s*\(\s*true\s*\)/i.test(stmt)
      if (forAll && toPublic && usingTrue) offenders.push(`  ${name}: ${m[1]}`)
    }
  }

  assert.equal(
    offenders.length,
    0,
    `익명에게 전부 열어 주는 정책 ${offenders.length}개\n${offenders.join('\n')}\n\n` +
      `TO public 은 로그인하지 않은 사람(anon)을 포함한다.\n` +
      `읽는 사람을 정해서 쓴다 — TO authenticated, 또는 USING 에 실제 조건을.`,
  )
})

test('259 가 뒤늦게 켠 표가 규칙에 잡힌다 (규칙이 도는지 확인)', () => {
  const sql = readMigrations()
    .filter((m) => m.name.startsWith('259_'))
    .map((m) => m.sql)
    .join('\n')

  assert.ok(sql.length > 0, '259 마이그레이션을 못 찾았다 — 규칙이 빈 대상 위에서 돈다')
  for (const t of LATE_ENABLED) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE public\\.${t}\\s+(?:FORCE\\s+)?ENABLE ROW LEVEL SECURITY`, 'i'),
      `259 가 ${t} 의 RLS 를 켜지 않는다`,
    )
  }
})
