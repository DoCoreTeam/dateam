/**
 * CRM 시드 (dacrm T0-07)
 *
 *   pnpm --filter web exec prisma db seed          적용
 *   pnpm --filter web exec prisma db seed -- --verify-only   확인만(쓰기 없음)
 *
 * 원칙
 *  - 몇 번을 돌려도 결과가 같다(전부 upsert, id 고정).
 *  - 기존 데이터를 지우지 않는다. deleteMany 로 시작하는 시드는 여기서 금지다 —
 *    이 DB 는 운영 DB 이고, 시드는 실사용이 시작된 뒤에도 다시 돌 수 있다.
 *  - 접근은 getCrmDb 를 통한다(절대규칙 4). 워크스페이스 id 가 고정값이라 부트스트랩이 가능하다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCrmDb } from '../lib/crm/db/client.ts'
import { SEED_WORKSPACE, SEED_OWNER, SEED_PIPELINES, WORKSPACE_ID } from './seed-data.ts'

/**
 * Prisma CLI 는 .env 를 읽지만 .env.local 은 읽지 않는다.
 * 이 저장소의 시크릿은 .env.local 에 있으므로(gitignore 대상) 여기서 직접 채운다.
 */
function loadEnvLocal(): void {
  if (process.env.DATABASE_URL) return
  try {
    const raw = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      if (process.env[key]) continue
      process.env[key] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // 없으면 그대로 둔다. 아래에서 DATABASE_URL 부재를 명시적으로 알린다.
  }
}

loadEnvLocal()

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 이 없습니다. apps/web/.env.local 을 확인하세요.')
  process.exit(1)
}

const verifyOnly = process.argv.includes('--verify-only')
const db = getCrmDb(WORKSPACE_ID)

async function seed(): Promise<void> {
  // 1) 워크스페이스 — id 가 곧 워크스페이스 식별자다
  await db.crmWorkspace.upsert({
    where: { id: WORKSPACE_ID },
    create: SEED_WORKSPACE,
    update: { name: SEED_WORKSPACE.name },
  })
  console.log(`  워크스페이스: ${SEED_WORKSPACE.name} (${WORKSPACE_ID})`)

  // 2) 멤버(본인) — 호스트 profiles.id 로 연결한다. 인증은 호스트 세션이 한다
  await db.crmMember.upsert({
    // 복합 unique 헬퍼는 쓸 수 없다 — 유일성이 DB 의 부분 유니크 인덱스(마이그 201)로 옮겨갔다.
    // 대신 고정 id 로 upsert 한다(멱등성은 그대로).
    where: { id: SEED_OWNER.id },
    create: {
      id: SEED_OWNER.id,
      // workspaceId 를 명시한다 — 가드가 주입도 하지만, Prisma 타입은 그 사실을 모른다.
      // 명시하면 가드가 '일치하는지'를 검증하므로 안전성은 그대로다(불일치면 던진다).
      workspaceId: WORKSPACE_ID,
      hostUserId: SEED_OWNER.hostUserId,
      role: SEED_OWNER.role,
      displayName: SEED_OWNER.displayName,
      email: SEED_OWNER.email,
    },
    update: { displayName: SEED_OWNER.displayName, email: SEED_OWNER.email, role: SEED_OWNER.role },
  })
  console.log(`  멤버: ${SEED_OWNER.displayName} <${SEED_OWNER.email}> ${SEED_OWNER.role}`)

  // 3) 파이프라인 4종과 스테이지
  for (const p of SEED_PIPELINES) {
    await db.crmPipeline.upsert({
      where: { id: p.id },
      create: { id: p.id, workspaceId: WORKSPACE_ID, name: p.name, isDefault: p.isDefault, position: p.position },
      update: { name: p.name, isDefault: p.isDefault, position: p.position },
    })
    for (const s of p.stages) {
      await db.crmStage.upsert({
        where: { id: s.id },
        create: { id: s.id, pipelineId: p.id, name: s.name, kind: s.kind, position: s.position },
        update: { name: s.name, kind: s.kind, position: s.position },
      })
    }
    console.log(`  파이프라인: ${p.name} — 스테이지 ${p.stages.length}개`)
  }
}

async function verify(): Promise<boolean> {
  let ok = true
  const check = (label: string, expected: unknown, actual: unknown) => {
    const pass = JSON.stringify(expected) === JSON.stringify(actual)
    if (!pass) ok = false
    console.log(`${pass ? '✅' : '❌'} ${label}: ${pass ? actual : `기대 ${expected} / 실제 ${actual}`}`)
  }

  const ws = await db.crmWorkspace.findUnique({ where: { id: WORKSPACE_ID } })
  check('워크스페이스 1개', SEED_WORKSPACE.name, ws?.name ?? null)
  check('기본 통화 KRW', 'KRW', ws?.defaultCurrency?.trim() ?? null)

  const members = await db.crmMember.findMany()
  check('멤버 수', 1, members.length)
  check('소유자 역할', 'OWNER', members[0]?.role ?? null)
  check('소유자 호스트 id', SEED_OWNER.hostUserId, members[0]?.hostUserId ?? null)

  const pipelines = await db.crmPipeline.findMany({ orderBy: { position: 'asc' } })
  check('파이프라인 수', 4, pipelines.length)
  check('파이프라인 이름', SEED_PIPELINES.map((p) => p.name), pipelines.map((p) => p.name))
  check('기본 파이프라인 1개', 1, pipelines.filter((p) => p.isDefault).length)

  for (const p of SEED_PIPELINES) {
    // 자식(PARENT_SCOPED)은 부모를 경유해 조회한다
    const rows = await db.crmStage.findMany({ where: { pipelineId: p.id }, orderBy: { position: 'asc' } })
    check(`  ${p.name} 스테이지`, p.stages.map((s) => s.name), rows.map((s) => s.name))
    check(`  ${p.name} WON/LOST 각 1개`, [1, 1], [
      rows.filter((s) => s.kind === 'WON').length,
      rows.filter((s) => s.kind === 'LOST').length,
    ])
  }

  // 시드는 코어 레코드(회사·딜)를 만들지 않는다. 만들면 실데이터와 섞여 구분이 안 된다.
  // "0건"으로 확인할 수는 없다 — T0-11 이관과 실사용이 그 표에 행을 넣기 때문이다.
  // 그래서 **시드가 쓰는 id 접두사로** 확인한다(시드가 만든 것은 ws_/mb_/pl_/st_ 뿐이다).
  check('시드가 만든 회사 0건', 0, await db.crmCompany.count({ where: { id: { startsWith: 'co_seed' } } }))
  check('시드가 만든 딜 0건', 0, await db.crmDeal.count({ where: { id: { startsWith: 'dl_seed' } } }))
  console.log(`   (참고: 현재 회사 ${await db.crmCompany.count()}건 · 딜 ${await db.crmDeal.count()}건 — 이관·실사용분)`)

  return ok
}

async function main(): Promise<void> {
  if (!verifyOnly) {
    console.log('🌱 시드 적용')
    await seed()
    console.log()
  }
  console.log('🔎 검증')
  const ok = await verify()
  console.log()
  console.log(ok ? '🎉 전부 통과' : '💥 실패 항목이 있습니다')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('❌ 시드 실패:', e)
  process.exit(1)
})
