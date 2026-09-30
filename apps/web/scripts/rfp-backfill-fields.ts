// scripts/rfp-backfill-fields.ts — 이미 쌓인 리포트 판에서 **근거 필드를 다시 뽑아 채운다**
//
// ## 왜 필요한가
//
// 저장 경로가 여러 행을 넣고 `single()` 을 불렀다. PostgREST 는 한 행을 달라고 했는데 여러 행이
// 나오면 거절하면서 **넣던 것까지 되돌린다.** 그 오류(PGRST116)를 코드가 「실패가 아님」으로
// 걸러 내고 있어 아무도 몰랐다. 실측 2026-09-30: 리포트 판 5개, 근거 필드 **0행**.
//
// 저장 경로는 고쳤다(v0.10.769). 그러나 이미 지나간 판은 스스로 안 채워진다 —
// 원본 JSON 은 남아 있으므로 거기서 다시 뽑으면 된다.
//
// ## 뽑는 규칙을 또 적지 않는다
//
// `toFieldRows` 를 그대로 부른다. 여기에 같은 로직을 다시 쓰면 두 벌이 갈라지고,
// 갈라진 사실은 화면에서 값이 다르게 보일 때에야 드러난다.
//
// ## 계약 판 번호를 지금 것으로 덮지 않는다
//
// 판 번호는 값을 **만들 때만** 안다. 되살리는 지금 것을 적으면 「그때 무슨 규칙으로 만들었나」가
// 영영 사라진다. 그래서 원본 판이 들고 있던 `contract_version` 을 그대로 옮긴다.
//
// ## 두 번 돌려도 안 늘어난다
//
// 근거 필드가 이미 하나라도 있는 판은 아예 안 읽는다. 그래서 다시 돌리면 대상이 0건이 된다.
//
// 쓰기: DATABASE_URL=... node --experimental-strip-types scripts/rfp-backfill-fields.ts [--apply]
//       (기본은 미리보기, --apply 를 줘야 실제로 쓴다)

import { execFileSync } from 'node:child_process'
import { toFieldRows } from '../lib/rfp/analyze/persist.ts'
import type { Report } from '../lib/rfp/report/schema.ts'

const PG = process.env.DATABASE_URL ?? ''
if (!PG) {
  console.error('DATABASE_URL 에 연결 문자열이 필요합니다 (비밀은 PGPASSWORD 로 따로 넘깁니다)')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

function psql(sql: string): string {
  return execFileSync('psql', [PG, '-At', '-c', sql], { maxBuffer: 1 << 28 }).toString()
}

/** SQL 문자열 리터럴로 감싼다 — 작은따옴표를 두 번 적어 닫히지 않게 한다 */
const q = (v: string): string => `'${v.replace(/'/g, "''")}'`
/** 숫자와 null 은 따옴표 없이 간다. NaN·Infinity 는 SQL 이 모르므로 null 로 눕힌다 */
const num = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'null' : String(v))

interface VersionRow {
  id: string
  org_id: string
  contract_version: number | null
  report: Report
}

/**
 * 근거 필드가 **한 행도 없는** 판만 가져온다.
 *
 * 줄 단위로 쪼개지 않고 JSON 한 덩이로 받는다 — 리포트 본문에 줄바꿈이 들어 있어서
 * 줄로 쪼개면 한 판이 여러 줄로 찢어진다.
 */
const raw = psql(`
  select coalesce(json_agg(t)::text, '[]') from (
    select v.id, v.org_id, v.contract_version, v.report
      from rfp_report_versions v
     where not exists (select 1 from rfp_report_fields f where f.report_version_id = v.id)
     order by v.created_at
  ) t`).trim()

const versions = JSON.parse(raw) as VersionRow[]
console.log(`근거 필드가 비어 있는 판 ${versions.length}건`)

let planned = 0
let wrote = 0
const skipped: string[] = []

for (const v of versions) {
  const rows = toFieldRows(v.report)
  if (rows.length === 0) {
    // 말단 값이 하나도 없는 판. 넣을 것이 없으니 건너뛴다 — 빈 행을 만들면 「못 찾음」과 섞인다
    skipped.push(v.id)
    continue
  }
  planned += rows.length

  const values = rows.map((r) => [
    q(v.id), q(v.org_id), q(r.fieldPath),
    `${q(JSON.stringify(r.value ?? null))}::jsonb`,
    num(r.valueNum),
    r.valueText === null ? 'null' : q(r.valueText),
    num(r.confidence),
    q(r.grounding), q(r.verification),
    `${q(JSON.stringify(r.evidence ?? []))}::jsonb`,
    v.contract_version === null ? 'null' : String(v.contract_version),
  ].join(',')).map((s) => `(${s})`).join(',\n    ')

  if (!APPLY) {
    console.log(`  [미리보기] ${v.id} → ${rows.length}행`)
    continue
  }

  // 한 판은 통째로 들어가거나 통째로 안 들어간다. 반만 들어가면 다음 번에 그 판을 아예 안 읽는다
  const out = psql(`
    begin;
    insert into rfp_report_fields
      (report_version_id, org_id, field_path, value, value_num, value_text,
       confidence, grounding, verification, evidence, contract_version)
    values
    ${values};
    commit;
    select count(*) from rfp_report_fields where report_version_id = ${q(v.id)};`)

  const got = Number(out.trim().split('\n').filter(Boolean).pop())
  if (got !== rows.length) {
    console.error(`${v.id}: ${rows.length}행 넣으려 했는데 ${got}행만 들어갔다`)
    process.exit(1)
  }
  wrote += got
  console.log(`  ${v.id} → ${got}행`)
}

if (skipped.length > 0) {
  console.log(`말단 값이 없어 건너뛴 판 ${skipped.length}건: ${skipped.join(', ')}`)
}
console.log(
  APPLY
    ? `넣은 근거 필드 ${wrote}행. 다시 돌리면 대상이 0건이어야 한다`
    : `넣을 근거 필드 ${planned}행. 실제로 쓰려면 --apply 를 준다`,
)
