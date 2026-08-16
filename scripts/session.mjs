#!/usr/bin/env node
/**
 * 다중 세션 작업 보드 (advisory — 강제 락이 아니다)
 *
 * 왜: 여러 세션(Claude Code 창 N개 · Codex · Ralph 루프)이 같은 작업 트리를 공유하는데
 * 서로를 볼 수 없다. 그래서 같은 파일을 동시에 고치고, 같은 버전·마이그레이션 번호를 쓰고,
 * 남이 만든 화면 결함을 자기 것으로 오진한다. 이 보드는 "누가 무엇을 들고 있는지"를
 * 파일 하나로 드러내 그 사고를 사전에 막는다.
 *
 * 강제하지 않는다(락 아님). 착수 전에 읽고, 겹치면 사람이 판단한다.
 * 저장 위치 .sessions/ 는 gitignore — 커밋되지 않는다.
 *
 *   node scripts/session.mjs claim <이름> --task "설명" --files "경로,경로" [--exclusive]
 *   node scripts/session.mjs progress <이름> --node "노드명" [--done 3] [--total 7]
 *   node scripts/session.mjs finding <이름> --what "설명" [--where "파일:줄"] [--sev high|medium|low] [--scope mine|outside]
 *   node scripts/session.mjs board [--json]
 *   node scripts/session.mjs release <이름>
 *
 * 지시 버스 (M-14 · +@ 전파) — 사용자의 지시는 세션 하나에만 도착한다.
 * 받은 세션이 옮기지 않으면 나머지는 옛 기준으로 계속 간다. 그래서 통로를 강제한다.
 *
 *   node scripts/session.mjs broadcast <보낸세션> --what "지시 원문" [--kind directive|notice|ask] [--why "..."] [--files "..."]
 *   node scripts/session.mjs inbox <이름> [--all] [--json]
 *   node scripts/session.mjs ack <이름> --note "내 작업에 어떻게 반영했는지(해당없으면 이유)"
 */
import { readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, unlinkSync, renameSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, '.sessions')
/** 지시 버스 — append-only. 세션 파일과 분리해 둔다(누가 죽어도 지시는 남아야 한다). */
const BUS = join(DIR, '_bus.jsonl')
/** 이 시간 넘게 갱신이 없으면 죽은 세션으로 본다 — TTL 없는 영구 claim은 보드를 쓸모없게 만든다. */
const STALE_MINUTES = 30
const MAX_LOG = 50
const BUS_KINDS = ['directive', 'notice', 'ask']

const nowIso = () => new Date().toISOString()
const minutesSince = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session'

function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else { flags[key] = next; i++ }
    } else rest.push(a)
  }
  return { flags, rest }
}

function readAll() {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(DIR, f), 'utf8')) } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
}

function save(session) {
  mkdirSync(DIR, { recursive: true })
  // 보드는 세션 로컬 상태 — 디렉터리가 스스로를 무시하게 한다.
  // 루트 .gitignore는 M-5 충돌 핫스팟이라 건드리지 않는다(남의 미커밋 줄과 얽힌다).
  const ignore = join(DIR, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8')
  const target = join(DIR, `${session.name}.json`)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', 'utf8')
  renameSync(tmp, target) // 원자적 교체 — 다른 세션이 반쯤 쓰인 파일을 읽지 않게
}

function load(name) {
  const p = join(DIR, `${name}.json`)
  if (!existsSync(p)) die(`세션 '${name}'이 보드에 없습니다. 먼저 claim 하세요.`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

function die(msg) { console.error(`✖ ${msg}`); process.exit(1) }

/** glob → 정규식. `**`=경로 전체, `*`=한 구간, `?`=한 글자. */
function globToRe(g) {
  const src = g.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${src}$`)
}

/** 두 파일 패턴이 겹칠 수 있는가. 정확한 판정은 불가능하므로 '의심되면 겹친다'로 본다. */
function patternsOverlap(a, b) {
  if (a === b) return true
  const [ra, rb] = [globToRe(a), globToRe(b)]
  if (ra.test(b) || rb.test(a)) return true
  // 디렉터리 포함 관계: "apps/web/lib/" 와 "apps/web/lib/foo.ts"
  const norm = (s) => (s.endsWith('/') ? s : `${s}/`)
  return b.startsWith(norm(a)) || a.startsWith(norm(b))
}

function conflictsFor(name, files, sessions) {
  const hits = []
  for (const s of sessions) {
    if (s.name === name || s.released) continue
    if (minutesSince(s.updatedAt) > STALE_MINUTES) continue
    const shared = files.filter((f) => (s.files || []).some((g) => patternsOverlap(f, g)))
    if (shared.length) hits.push({ session: s, shared, exclusive: !!s.exclusive })
  }
  return hits
}

// ── 지시 버스 (M-14) ───────────────────────────────────────────────────────────
// 세션 파일은 "내가 무엇을 하는가", 버스는 "우리 모두가 무엇을 따라야 하는가"다.
// 섞으면 세션이 release될 때 지시까지 사라진다. 그래서 append-only 파일로 따로 둔다.

function readBus() {
  if (!existsSync(BUS)) return []
  return readFileSync(BUS, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

function appendBus(entry) {
  mkdirSync(DIR, { recursive: true })
  const ignore = join(DIR, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8')
  // O_APPEND 한 줄 쓰기 — 두 세션이 동시에 써도 줄이 섞이지 않는다.
  appendFileSync(BUS, JSON.stringify(entry) + '\n', 'utf8')
}

const busSeen = (s) => Number(s?.busSeen ?? 0)
const unreadFor = (s, bus) => bus.filter((e) => e.seq > busSeen(s) && e.from !== s.name)

function fmtBusEntry(e) {
  const mark = e.kind === 'directive' ? '📌' : e.kind === 'ask' ? '❓' : '📣'
  const head = `${mark} #${e.seq} [${e.kind}] ${e.what}`
  const tail = [
    e.why ? `    └ 왜: ${e.why}` : null,
    (e.files || []).length ? `    └ 관련 파일: ${e.files.join(', ')}` : null,
    `    └ from ${e.from} · ${minutesSince(e.at)}분 전`,
  ].filter(Boolean)
  return [head, ...tail].join('\n')
}

// ── commands ──────────────────────────────────────────────────────────────────

function cmdClaim(rest, flags) {
  const name = slug(rest[0] || die('세션 이름이 필요합니다. 예: claim gpu-pricing --task "..." --files "..."'))
  const files = String(flags.files || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!files.length) die('--files 는 필수입니다. 이 작업에서 "쓸" 파일을 먼저 확정하세요(읽기만 하는 파일은 제외).')

  const sessions = readAll()
  const hits = conflictsFor(name, files, sessions)

  const prev = existsSync(join(DIR, `${name}.json`)) ? load(name) : null
  save({
    name,
    task: flags.task || prev?.task || '(설명 없음)',
    files,
    exclusive: !!flags.exclusive,
    startedAt: prev?.startedAt || nowIso(),
    updatedAt: nowIso(),
    node: prev?.node || null,
    done: prev?.done ?? 0,
    total: prev?.total ?? 0,
    findings: prev?.findings || [],
    log: prev?.log || [],
    // 읽음 커서와 확인 이력은 **반드시 물려받는다**. 작업 범위가 늘어 같은 이름으로 다시 claim하는 것은
    // 정상 절차인데(M-7 파일 소유권 갱신), 여기서 초기화되면 이미 확인한 지시가 다시 '미확인'으로 뜬다.
    // M-14는 "도달의 근거는 보드의 📬 미확인 0"이라고 못 박았다 — 그 숫자가 거짓이 되면 규칙이 무너진다.
    busSeen: prev?.busSeen ?? 0,
    acks: prev?.acks || [],
    released: false,
  })

  console.log(`✔ claim: ${name} — ${flags.task || ''}`)
  console.log(`  담당 파일 ${files.length}개: ${files.join(', ')}`)
  if (!hits.length) { console.log('  겹치는 세션 없음 — 병렬로 진행해도 됩니다.'); return }

  console.log('')
  console.log(`⚠ 겹치는 세션 ${hits.length}건 — 병렬 금지. 직렬화하거나 담당 파일을 나누세요.`)
  for (const h of hits) {
    console.log(`  · ${h.session.name}${h.exclusive ? ' [배타]' : ''} (${h.session.task})`)
    console.log(`    겹침: ${h.shared.join(', ')}`)
  }
  console.log('')
  console.log('  판단 기준: 겹치는 파일은 "추가 전용(additive-only)"으로만 고친다.')
  console.log('  삭제·이름변경·시그니처 변경이 필요하면 --exclusive 로 단독 창구를 잡고 상대 세션이 비운 뒤에 한다.')
  process.exitCode = 2 // 겹침은 실패가 아니라 경고 — 스크립트에서 감지할 수 있게 코드만 남긴다
}

function cmdProgress(rest, flags) {
  const name = slug(rest[0] || die('세션 이름이 필요합니다.'))
  const s = load(name)
  if (flags.node) s.node = String(flags.node)
  if (flags.done !== undefined) s.done = Number(flags.done)
  if (flags.total !== undefined) s.total = Number(flags.total)
  s.updatedAt = nowIso()
  s.log = [...(s.log || []), { at: s.updatedAt, node: s.node, done: s.done, total: s.total }].slice(-MAX_LOG)
  save(s)
  console.log(`✔ ${name} · ${s.node || '-'} · ${s.done}/${s.total || '?'}`)
}

function cmdFinding(rest, flags) {
  const name = slug(rest[0] || die('세션 이름이 필요합니다.'))
  const what = flags.what || die('--what 은 필수입니다. 무엇이 잘못됐는지 한 줄로.')
  const s = load(name)
  const finding = {
    at: nowIso(),
    what: String(what),
    where: flags.where ? String(flags.where) : null,
    severity: ['high', 'medium', 'low'].includes(flags.sev) ? flags.sev : 'medium',
    scope: flags.scope === 'outside' ? 'outside' : 'mine', // outside = 내 작업 범위 밖 → 고치지 말고 보고
  }
  s.findings = [...(s.findings || []), finding]
  s.updatedAt = finding.at
  save(s)
  console.log(`✔ 발견 기록 (${finding.severity}/${finding.scope}): ${finding.what}${finding.where ? ` @ ${finding.where}` : ''}`)
  if (finding.scope === 'outside') {
    console.log('  범위 밖입니다 — 고치지 말고 세션 종료 보고에 반드시 포함하세요.')
  }
}

function cmdBroadcast(rest, flags) {
  const from = slug(rest[0] || die('보낸 세션 이름이 필요합니다. 예: broadcast gpu-pricing --what "..."'))
  const what = flags.what || die('--what 은 필수입니다. 사용자의 지시를 **원문에 가깝게** 적으세요(요약하면 뜻이 바뀝니다).')
  const kind = BUS_KINDS.includes(flags.kind) ? flags.kind : 'directive'
  const files = String(flags.files || '').split(',').map((s) => s.trim()).filter(Boolean)

  const bus = readBus()
  const entry = {
    seq: (bus.at(-1)?.seq ?? 0) + 1,
    at: nowIso(),
    from,
    kind,
    what: String(what),
    why: flags.why ? String(flags.why) : null,
    files,
  }
  appendBus(entry)

  const live = readAll().filter((s) => !s.released && minutesSince(s.updatedAt) <= STALE_MINUTES && s.name !== from)
  console.log(`✔ 전파 #${entry.seq} (${kind}) — ${entry.what}`)
  if (!live.length) {
    console.log('  지금 활성 세션이 없습니다. 버스에 남았으니 다음 세션이 inbox에서 받습니다.')
    return
  }
  console.log(`  확인해야 할 활성 세션 ${live.length}개: ${live.map((s) => s.name).join(', ')}`)
  console.log('  각 세션은 `inbox <이름>`으로 읽고 `ack <이름> --note "반영 방법"`으로 응답합니다.')
}

function cmdInbox(rest, flags) {
  const name = slug(rest[0] || die('세션 이름이 필요합니다.'))
  const bus = readBus()
  const known = existsSync(join(DIR, `${name}.json`))
  const s = known ? load(name) : { name, busSeen: 0 }
  const items = flags.all ? bus.filter((e) => e.from !== name) : unreadFor(s, bus)

  if (flags.json) { console.log(JSON.stringify(items, null, 2)); return }
  if (!known) console.log(`⚠ '${name}'은 보드에 없습니다 — 먼저 claim 하세요. (ack가 기록되지 않습니다)`)
  if (!items.length) { console.log(`📭 ${name}: 새 지시 없음 (확인 지점 #${busSeen(s)})`); return }

  console.log(`📬 ${name}: 미확인 ${items.length}건 (확인 지점 #${busSeen(s)} 이후)`)
  console.log('─'.repeat(96))
  for (const e of items) console.log(fmtBusEntry(e))
  console.log('─'.repeat(96))
  console.log('내 지시가 아니어도 **내 작업에 적용되는 기준**이면 지금 범위에 넣습니다 (M-14).')
  console.log(`읽었으면: node scripts/session.mjs ack ${name} --note "어떻게 반영했는지 / 해당없으면 이유"`)
}

function cmdAck(rest, flags) {
  const name = slug(rest[0] || die('세션 이름이 필요합니다.'))
  const note = flags.note || die('--note 는 필수입니다. "읽었다"가 아니라 **내 작업에 어떻게 반영했는지**를 적으세요(해당 없으면 그 이유).')
  const s = load(name)
  const bus = readBus()
  const unread = unreadFor(s, bus)
  if (!unread.length) { console.log(`📭 ${name}: 확인할 지시가 없습니다.`); return }

  const upto = bus.at(-1).seq
  s.busSeen = upto
  s.acks = [...(s.acks || []), { at: nowIso(), upto, note: String(note) }].slice(-MAX_LOG)
  s.updatedAt = nowIso()
  save(s)
  console.log(`✔ ${name}: #${upto}까지 확인 (${unread.length}건) — ${note}`)
}

function cmdRelease(rest) {
  const name = slug(rest[0] || die('세션 이름이 필요합니다.'))
  const s = load(name)
  const open = (s.findings || []).filter((f) => f.scope === 'outside')
  const unread = unreadFor(s, readBus())
  unlinkSync(join(DIR, `${name}.json`))
  console.log(`✔ release: ${name} (경과 ${minutesSince(s.startedAt)}분, 노드 ${s.done}/${s.total || '?'})`)
  if (open.length) {
    console.log(`⚠ 범위 밖 발견 ${open.length}건 — 사용자에게 보고했는지 확인하세요:`)
    for (const f of open) console.log(`  · [${f.severity}] ${f.what}${f.where ? ` @ ${f.where}` : ''}`)
  }
  if (unread.length) {
    console.log(`⚠ 확인하지 않은 지시 ${unread.length}건을 남기고 종료했습니다 — 사용자에게 보고하세요:`)
    for (const e of unread) console.log(`  · #${e.seq} [${e.kind}] ${e.what} (from ${e.from})`)
  }
}

function bar(done, total) {
  if (!total) return '░'.repeat(10)
  const filled = Math.max(0, Math.min(10, Math.round((done / total) * 10)))
  return '▓'.repeat(filled) + '░'.repeat(10 - filled)
}

function pad(s, n) {
  // 한글은 2칸으로 세어 표를 맞춘다
  const w = [...String(s)].reduce((a, c) => a + (/[ᄀ-ᇿ　-〿가-힯＀-￯]/.test(c) ? 2 : 1), 0)
  return String(s) + ' '.repeat(Math.max(1, n - w))
}

function cmdBoard(flags) {
  const sessions = readAll()
  const bus = readBus()
  if (flags.json) { console.log(JSON.stringify({ sessions, bus }, null, 2)); return }
  if (!sessions.length) {
    console.log('활성 세션 없음. (claim 으로 등록하세요)')
    if (bus.length) console.log(`📬 대기 중인 지시 ${bus.length}건 — claim 후 inbox 로 받으세요.`)
    return
  }

  const rows = sessions.map((s) => {
    const elapsed = minutesSince(s.startedAt)
    const idle = minutesSince(s.updatedAt)
    const speed = elapsed > 0 && s.done > 0 ? (s.done / elapsed) * 60 : 0
    return { s, elapsed, idle, speed, stale: idle > STALE_MINUTES }
  })
  const fastest = Math.max(...rows.map((r) => r.speed))

  console.log(`🗂  세션 보드 — 활성 ${rows.filter((r) => !r.stale).length} / 전체 ${rows.length}`)
  console.log('─'.repeat(96))
  console.log(pad('세션', 23) + pad('진척', 20) + pad('경과', 8) + pad('최근', 9) + pad('속도', 12) + '현재 노드')
  console.log('─'.repeat(96))
  for (const r of rows) {
    const mark = r.stale ? '💤' : r.speed > 0 && r.speed === fastest ? '🥇' : '  '
    console.log(
      pad(`${mark}${r.s.name.length > 20 ? `${r.s.name.slice(0, 19)}…` : r.s.name}`, 23) +
      pad(`${bar(r.s.done, r.s.total)} ${r.s.done}/${r.s.total || '?'}`, 20) +
      pad(`${r.elapsed}분`, 8) +
      pad(r.stale ? `${r.idle}분⚠` : `${r.idle}분`, 9) +
      pad(r.speed ? `${r.speed.toFixed(1)}노드/h` : '-', 12) +
      (r.s.node || '-')
    )
    console.log(pad('', 23) + `↳ ${r.s.task}`)
    console.log(pad('', 23) + `↳ 파일: ${(r.s.files || []).join(', ')}${r.s.exclusive ? '  [배타]' : ''}`)
    const unread = unreadFor(r.s, bus)
    if (unread.length) console.log(pad('', 23) + `↳ 📬 미확인 지시 ${unread.length}건 (#${unread.map((e) => e.seq).join(', #')}) — inbox ${r.s.name}`)
  }
  console.log('─'.repeat(96))

  // 파일 겹침 경보 — 병렬로 돌면 안 되는 조합을 드러낸다
  const live = rows.filter((r) => !r.stale).map((r) => r.s)
  const seen = new Set()
  const clashes = []
  for (const a of live) {
    for (const c of conflictsFor(a.name, a.files || [], live)) {
      const key = [a.name, c.session.name].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      clashes.push({ a: a.name, b: c.session.name, shared: c.shared })
    }
  }
  if (clashes.length) {
    console.log(`⚠ 파일 겹침 ${clashes.length}건 — 이 조합은 병렬로 진행하면 안 됩니다.`)
    for (const c of clashes) console.log(`  · ${c.a} ↔ ${c.b}: ${c.shared.join(', ')}`)
  } else {
    console.log('✔ 파일 겹침 없음')
  }

  const findings = live.flatMap((s) => (s.findings || []).map((f) => ({ ...f, by: s.name })))
  const outside = findings.filter((f) => f.scope === 'outside')
  if (findings.length) {
    console.log('')
    console.log(`🔎 발견 ${findings.length}건 (범위 밖 ${outside.length}건 — 보고 의무)`)
    for (const f of findings) {
      console.log(`  · [${f.severity}/${f.scope}] ${f.what}${f.where ? ` @ ${f.where}` : ''} (by ${f.by})`)
    }
  }
  // 지시 버스 — 최근 것부터. 아직 안 받은 세션이 있으면 그것이 이 보드의 최우선 신호다.
  if (bus.length) {
    console.log('')
    console.log(`📣 지시 버스 — 전체 ${bus.length}건 (최근 5건)`)
    for (const e of bus.slice(-5)) console.log(fmtBusEntry(e))
    const behind = live
      .map((s) => ({ name: s.name, n: unreadFor(s, bus).length }))
      .filter((x) => x.n > 0)
    if (behind.length) {
      console.log('')
      console.log(`⚠ 아직 확인하지 않은 세션 ${behind.length}개 — 이들은 옛 기준으로 작업 중입니다.`)
      for (const b of behind) console.log(`  · ${b.name}: ${b.n}건 미확인`)
    } else {
      console.log('✔ 활성 세션 전원이 최신 지시까지 확인했습니다.')
    }
  }

  if (rows.some((r) => r.stale)) {
    console.log('')
    console.log(`💤 ${STALE_MINUTES}분 넘게 갱신 없는 세션은 죽은 것으로 봅니다. claim 을 무시해도 됩니다.`)
  }
}

// ── entry ─────────────────────────────────────────────────────────────────────

const [, , cmd, ...argv] = process.argv
const { flags, rest } = parseArgs(argv)

switch (cmd) {
  case 'claim': cmdClaim(rest, flags); break
  case 'progress': cmdProgress(rest, flags); break
  case 'finding': cmdFinding(rest, flags); break
  case 'broadcast': cmdBroadcast(rest, flags); break
  case 'inbox': cmdInbox(rest, flags); break
  case 'ack': cmdAck(rest, flags); break
  case 'release': cmdRelease(rest); break
  case 'board': case undefined: cmdBoard(flags); break
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n'))
    process.exit(cmd ? 1 : 0)
}
