// scripts/backfill-system-log-reason.ts — 이미 쌓인 「원인 미상」 중 **증명되는 것만** 올린다
//
// ## 왜 전체 재계산을 안 하나
//
// `reason` 과 `detail` 은 기록하는 순간 굳는 값이다. 그래서 분류기를 고쳐도 이미 쌓인 줄은
// 옛 문장을 그대로 들고 있다. 그러면 전부 다시 계산하면 되지 않나 싶지만, **안 된다.**
//
// 분류기는 `prismaCode` 와 `geminiReason` 같은 **기록 때만 있던 신호**를 함께 본다.
// 그 신호는 칼럼으로 안 남아서, 저장된 행만 가지고는 복원할 수 없다. 실측 2026-09-20:
// 전체로 돌리면 **16,821행이 제대로 된 사유에서 `unknown` 으로 떨어진다.**
// 고치려던 화면을 더 크게 망가뜨리는 셈이다.
//
// 그래서 **단조로만 움직인다** — `unknown` 에서 무엇인가로만 가고, 그 반대로는 안 간다.
// 이미 사유가 붙은 줄은 손대지 않으므로 이 스크립트는 구조적으로 나쁘게 만들 수 없다.
//
// ## 되돌리기
//
// 바꾸기 **전에** 옛 값을 파일로 남긴다. 되돌리는 명령은 그 파일과 함께 출력된다.
// 백업을 표로 뜨지 않는 이유: `CREATE TABLE AS` 는 원본의 RLS 를 안 물려받는다.
// 이 저장소는 그렇게 생긴 열린 사본 다섯 개를 이미 겪었다.
//
// 쓰기: node --experimental-strip-types scripts/backfill-system-log-reason.ts [--apply]
//       (기본은 미리보기, --apply 를 줘야 실제로 쓴다)

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { classifySystemReason, severityOf } from '../lib/system-log/reason.ts'
import { detailOf } from '../lib/system-log/narrate.ts'

const PG = process.env.SYSTEM_LOG_PG ?? ''
if (!PG) {
  console.error('SYSTEM_LOG_PG 에 연결 문자열이 필요합니다 (비밀은 PGPASSWORD 로 따로 넘깁니다)')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')
const SEP = String.fromCharCode(1)

/** SQL 문자열 리터럴로 안전하게 감싼다. 두 단계가 같이 쓴다 */
const q = (v: string): string => `'${v.replace(/'/g, "''")}'`

function psql(sql: string): string {
  return execFileSync('psql', [PG, '-At', '-c', sql], { maxBuffer: 1 << 28 }).toString()
}

/** 원문 첫 줄에서 던진 쪽 이름표를 떼어 메시지를 되찾는다 — 스택은 애초에 안 본다 */
function messageFromRaw(rawFirstLine: string): string {
  return rawFirstLine.replace(/^[A-Za-z][A-Za-z0-9_.$]*(Error|Exception):\s*/, '').trim()
}

const rows = psql(`
  select id||chr(1)||coalesce(source,'')||chr(1)||coalesce(feature,'')||chr(1)||coalesce(route,'')
      ||chr(1)||coalesce(context->>'errorCode','')||chr(1)||coalesce(reason,'')
      ||chr(1)||coalesce(severity,'')||chr(1)||replace(coalesce(detail,''), chr(1), ' ')
      ||chr(1)||replace(coalesce(fingerprint,''), chr(1), ' ')
      ||chr(1)||replace(split_part(coalesce(raw,''), chr(10), 1), chr(1), ' ')
    from system_events
   where resolved_at is null and reason = 'unknown'`).split('\n').filter(Boolean)

interface Change { id: string; from: Record<string, string>; to: Record<string, string> }
const changes: Change[] = []

for (const line of rows) {
  const [id, source, feature, route, errorCode, reason, severity, detail, fingerprint, rawFirst] = line.split(SEP)
  const message = messageFromRaw(rawFirst ?? '')
  const next = classifySystemReason({ crmCode: errorCode || null, message })
  if (next === 'unknown') continue   // 올라갈 것이 없으면 건드리지 않는다

  /*
    **웹 검색 한도에 「다른 모델로 바꾸세요」를 쓰지 않는다.**
    원문이 스스로 웹 검색이라고 말하는데 일반 한도 문장을 씌우면,
    이 백필이 방금 고친 버그를 246줄에 되살리게 된다.
  */
  const webSearch = /웹 검색 한도/.test(message)
  const nextSeverity = severityOf(next)
  const nextDetail = detailOf({ source, reason: next, feature: feature || null, route: route || null, webSearch, message })
  const nextFingerprint = (fingerprint ?? '').replace(`|${reason}|`, `|${next}|`)

  changes.push({
    id,
    from: { reason, severity, detail, fingerprint },
    to: { reason: next, severity: nextSeverity, detail: nextDetail, fingerprint: nextFingerprint },
  })
}

console.log(`대상 후보 ${rows.length}행 중 올라갈 것 ${changes.length}행`)
const byReason = new Map<string, number>()
for (const c of changes) byReason.set(c.to.reason, (byReason.get(c.to.reason) ?? 0) + 1)
for (const [r, n] of byReason) console.log(`  unknown -> ${r}: ${n}행`)
if (changes[0]) console.log(`  예시 문장: ${changes[0].to.detail.slice(0, 90)}`)

// 미리보기에서도 **둘째 단계까지** 보여 준다 — 여기서 나가면 아래를 못 본 채 판단하게 된다
if (APPLY && changes.length > 0) {
const undoPath = `/tmp/system-log-reason-undo-${changes.length}.json`
writeFileSync(undoPath, JSON.stringify(changes, null, 2))
console.log(`\n되돌릴 근거를 먼저 남겼습니다: ${undoPath}`)

const values = changes
  .map((c) => `(${q(c.id)}::uuid, ${q(c.to.reason)}, ${q(c.to.severity)}, ${q(c.to.detail)}, ${q(c.to.fingerprint)})`)
  .join(',\n    ')

// 조건에 reason='unknown' 을 다시 건다 — 그 사이 누가 고쳐 놨으면 안 건드린다
const out = psql(`
  with v(id, reason, severity, detail, fingerprint) as (values
    ${values}
  )
  update system_events e
     set reason = v.reason, severity = v.severity, detail = v.detail, fingerprint = v.fingerprint
    from v
   where e.id = v.id and e.reason = 'unknown' and e.resolved_at is null
  returning e.id`)
/*
  **줄을 세지 않는다.** `psql -At` 은 RETURNING 행 뒤에 `UPDATE <n>` 상태 줄을 하나 더 붙인다.
  처음엔 줄 수를 세어 246행을 바꿔 놓고 「247」이라고 보고했다 — 고치려던 결함과 같은 종류다.
  Postgres 가 직접 말하는 숫자를 읽는다.
*/
const applied = /^UPDATE (\d+)$/m.exec(out)?.[1]
console.log(`실제로 바뀐 행: ${applied ?? '(못 읽음 — psql 출력을 확인하세요)'}`)
console.log(`되돌리려면: 이 파일의 from 값을 id 별로 그대로 UPDATE (${undoPath})`)
}

/*
  ## 둘째 단계 — 사유는 맞는데 **조언이 반대인** 줄

  위 단계는 `unknown` 에서만 올라오므로, 이미 `quota` 가 붙은 줄은 안 건드린다.
  그런데 `ci.signals` 의 747행이 전부 「다른 모델로 바꾸면 됩니다」를 달고 있다.
  웹 검색 한도는 키 단위라 **모델을 바꿔도 안 풀린다** — 관리자가 시키는 대로 하면
  아무 일도 안 일어나고, 그 화면은 그때 신용을 잃는다.

  왜 이 자리는 추측이 아닌가: `lib/ci/ai/signals-server.ts` 가 **조건 없이**
  `hostAdapter(..., { webSearch: true })` 로 부른다. 이 기능의 실패는 정의상 웹 검색 호출이다.
  그래서 기능 이름 하나로 갈라도 지어내는 것이 없다.

  `detail` 만 바꾼다 — 사유·심각도·지문은 이미 맞으므로 손대지 않는다.
*/
const WEB_SEARCH_ONLY_FEATURES = ['ci.signals'] as const

const wrong = psql(`
  select id||chr(1)||coalesce(source,'')||chr(1)||coalesce(feature,'')||chr(1)||coalesce(route,'')
      ||chr(1)||replace(coalesce(detail,''), chr(1), ' ')
    from system_events
   where resolved_at is null and reason = 'quota'
     and feature in (${WEB_SEARCH_ONLY_FEATURES.map((f) => `'${f}'`).join(',')})`)
  .split('\n').filter(Boolean)

const fixes = wrong
  .map((line) => {
    const [id, source, feature, route, detail] = line.split(SEP)
    // 힌트(모델 이름)는 옛 문장에서 그대로 들고 온다 — 새로 지어내지 않는다
    const hint = /\(([^)]+)\)/.exec(detail ?? '')?.[1] ?? null
    const next = detailOf({ source, reason: 'quota', feature, route: route || null, hint, webSearch: true })
    return { id, from: detail, to: next }
  })
  .filter((f) => f.to !== f.from)

console.log(`\n조언이 반대인 줄 ${fixes.length}행`)
if (fixes[0]) console.log(`  ${fixes[0].from.slice(0, 60)}\n  -> ${fixes[0].to.slice(0, 80)}`)

if (APPLY && fixes.length > 0) {
  const undo2 = `/tmp/system-log-detail-undo-${fixes.length}.json`
  writeFileSync(undo2, JSON.stringify(fixes, null, 2))
  console.log(`되돌릴 근거: ${undo2}`)
  const vals = fixes.map((f) => `(${q(f.id)}::uuid, ${q(f.to)})`).join(',\n    ')
  const res = psql(`
    with v(id, detail) as (values
      ${vals}
    )
    update system_events e set detail = v.detail
      from v where e.id = v.id and e.reason = 'quota' and e.resolved_at is null
    returning e.id`)
  console.log(`실제로 바뀐 행: ${/^UPDATE (\d+)$/m.exec(res)?.[1] ?? '(못 읽음)'}`)
}

if (!APPLY) console.log('\n미리보기입니다. 실제로 쓰려면 --apply 를 주세요.')
