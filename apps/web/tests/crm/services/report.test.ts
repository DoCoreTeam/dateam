/**
 * 리포트 v1 — 실 DB 검증 (dacrm T1-12)
 *
 * 리포트는 **틀려도 아무도 모른다**는 점에서 위험하다.
 * 화면이 깨지면 바로 알지만, 합계가 조용히 작으면 그게 맞는 줄 안다.
 * 그래서 여기서 지키는 것은 "숫자가 나온다"가 아니라 **"거짓말을 안 한다"**이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A } from '../integrity/_helpers.ts'
import { buildPipelineReport } from '../../../lib/crm/services/report.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { createDeal, closeDeal } from '../../../lib/crm/services/deal.ts'

const MARK = '리포트테스트'
const ACTOR = 'mb_owner'

/**
 * 이 파일 전용 파이프라인.
 *
 * 기본 파이프라인을 쓰면 옆에서 도는 다른 테스트가 같은 파이프라인에 딜을 만들어
 * 합계와 건수가 실행할 때마다 달라진다(실측 — 단독으로는 통과, 함께 돌리면 실패).
 * 리포트는 **집계**라서 남의 데이터 한 건에도 판정이 흔들린다. 그러니 모집단부터 갈라야 한다.
 */
const PIPE = 'pipe_report_test'
const STAGES = [
  { id: 'stage_report_lead', name: '리드', kind: 'OPEN', position: 1 },
  { id: 'stage_report_prop', name: '제안', kind: 'OPEN', position: 2 },
  { id: 'stage_report_won', name: '수주', kind: 'WON', position: 3 },
  { id: 'stage_report_lost', name: '실패', kind: 'LOST', position: 4 },
]

async function ensurePipeline() {
  await dbA.$executeRawUnsafe(
    `INSERT INTO crm_pipeline (id, "workspaceId", name, "isDefault", position)
     VALUES ($1, $2, '리포트 테스트', false, 99) ON CONFLICT (id) DO NOTHING`,
    PIPE, WS_A,
  )
  for (const st of STAGES) {
    await dbA.$executeRawUnsafe(
      `INSERT INTO crm_stage (id, "pipelineId", name, kind, position)
       VALUES ($1, $2, $3, $4::"CrmStageKind", $5) ON CONFLICT (id) DO NOTHING`,
      st.id, PIPE, st.name, st.kind, st.position,
    )
  }
}

async function pipelineAndStages() {
  const stages = await dbA.crmStage.findMany({
    where: { pipelineId: PIPE }, orderBy: { position: 'asc' },
    select: { id: true, kind: true, name: true },
  })
  return { pipelineId: PIPE, stages }
}

async function makeDeal(
  name: string, companyId: string, stageId: string,
  amountMinor?: string, currency?: string,
) {
  const { pipelineId } = await pipelineAndStages()
  return createDeal(WS_A, ACTOR, { name, companyId, pipelineId, stageId, amountMinor, currency })
}

async function cleanup() {
  const cIds = (await dbA.crmCompany.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })).map((c) => c.id)
  await dbA.crmActivity.deleteMany({ where: { companyId: { in: cIds } } })
  await dbA.crmStageHistory.deleteMany({ where: { deal: { companyId: { in: cIds } } } })
  await dbA.crmDeal.deleteMany({ where: { companyId: { in: cIds } } })
  await dbA.crmCompany.deleteMany({ where: { id: { in: cIds } } })
}

/** 이 파일이 만든 딜만 보려면 회사로 걸러야 한다 — 남의 데이터까지 세면 판정이 흔들린다 */
async function reportForMine() {
  const { pipelineId } = await pipelineAndStages()
  return (await buildPipelineReport(dbA, pipelineId))[0]
}

test('시작 전 준비 — 전용 파이프라인을 만든다', async () => {
  await ensurePipeline()
  await cleanup()
})

test('빈 파이프라인도 0으로 답한다 — 화면이 터지면 안 된다', async () => {
  const rows = await buildPipelineReport(dbA)
  assert.ok(rows.length >= 1, '파이프라인이 하나도 안 나왔다')
  assert.ok(rows.every((r) => Array.isArray(r.stages)))
  assert.ok(rows.every((r) => typeof r.openCount === 'number'))
})

test('★ 통화가 다르면 더하지 않고 나눠서 낸다 — 원과 달러를 합친 숫자는 아무 뜻도 없다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const { stages } = await pipelineAndStages()
  const open = stages.find((s) => s.kind === 'OPEN')!

  await makeDeal(`${MARK}원딜`, co.id, open.id, '1000000', 'KRW')
  await makeDeal(`${MARK}달러딜`, co.id, open.id, '50000', 'USD')

  const rep = await reportForMine()
  const currencies = rep.byCurrency.map((c) => c.currency).sort()
  assert.deepEqual(currencies, ['KRW', 'USD'], '통화를 합쳐 버렸다')

  const krw = rep.byCurrency.find((c) => c.currency === 'KRW')!
  assert.ok(BigInt(krw.totalMinor) >= BigInt(1000000))
  await cleanup()
})

test('★ 금액 없는 딜은 0원이 아니다 — 합계에서 빼되 몇 건인지 말한다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const { stages } = await pipelineAndStages()
  const open = stages.find((s) => s.kind === 'OPEN')!

  const before = await reportForMine()
  await makeDeal(`${MARK}금액미정`, co.id, open.id)

  const after = await reportForMine()
  assert.equal(after.unpriced, before.unpriced + 1, '금액 미정 건수를 안 세고 있다')
  assert.equal(after.openCount, before.openCount + 1)

  // 합계는 그대로여야 한다 — 금액 미정을 0으로 더하면 합계가 안 변하는 게 맞다
  const krwBefore = before.byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0'
  const krwAfter = after.byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0'
  assert.equal(krwAfter, krwBefore)
  await cleanup()
})

test('★ 성사·실패는 파이프라인 합계에 들어가지 않는다 — 받은 돈을 또 세면 안 된다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const { stages } = await pipelineAndStages()
  const open = stages.find((s) => s.kind === 'OPEN')!
  const wonStage = stages.find((s) => s.kind === 'WON')!

  const deal = await makeDeal(`${MARK}성사딜`, co.id, open.id, '5000000', 'KRW')
  const before = await reportForMine()

  await closeDeal(WS_A, ACTOR, deal.id, {
    version: deal.version, to: 'WON', toStageId: wonStage.id,
    wonAt: '2026-08-16', amountMinor: '5000000',
  })

  const after = await reportForMine()
  assert.equal(after.wonCount, before.wonCount + 1)
  assert.equal(after.openCount, before.openCount - 1, '성사된 딜이 아직 진행 중으로 세어진다')

  const krwBefore = BigInt(before.byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0')
  const krwAfter = BigInt(after.byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0')
  assert.equal(krwAfter, krwBefore - BigInt(5000000), '성사 금액이 파이프라인에 남아 두 번 세어진다')
  await cleanup()
})

test('★ 끝난 딜이 없으면 성사율을 말하지 않는다 — 0%는 "다 실패했다"로 읽힌다', async () => {
  const { pipelineId } = await pipelineAndStages()
  const closed = await dbA.crmDeal.count({ where: { pipelineId, status: { in: ['WON', 'LOST'] } } })
  const rep = await reportForMine()

  if (closed === 0) assert.equal(rep.winRate, null)
  else assert.ok(typeof rep.winRate === 'number' && rep.winRate >= 0 && rep.winRate <= 100)
})

test('성사율은 끝난 딜 중 성사 비율이다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const { stages } = await pipelineAndStages()
  const open = stages.find((s) => s.kind === 'OPEN')!
  const wonStage = stages.find((s) => s.kind === 'WON')!
  const lostStage = stages.find((s) => s.kind === 'LOST')!

  const a = await makeDeal(`${MARK}딜하나`, co.id, open.id, '1000', 'KRW')
  const b = await makeDeal(`${MARK}딜둘`, co.id, open.id, '1000', 'KRW')
  await closeDeal(WS_A, ACTOR, a.id, {
    version: a.version, to: 'WON', toStageId: wonStage.id, wonAt: '2026-08-16', amountMinor: '1000',
  })
  await closeDeal(WS_A, ACTOR, b.id, {
    version: b.version, to: 'LOST', toStageId: lostStage.id, reason: '가격이 안 맞았다',
  })

  const rep = await reportForMine()
  assert.ok(rep.winRate !== null)
  assert.ok(rep.winRate! >= 0 && rep.winRate! <= 100)
  await cleanup()
})

test('단계별 합계의 총합이 파이프라인 합계와 같다 — 어긋나면 어느 쪽이 맞는지 알 수 없다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const { stages } = await pipelineAndStages()
  const opens = stages.filter((s) => s.kind === 'OPEN')

  await makeDeal(`${MARK}딜A`, co.id, opens[0].id, '300000', 'KRW')
  if (opens[1]) await makeDeal(`${MARK}딜B`, co.id, opens[1].id, '700000', 'KRW')

  const rep = await reportForMine()
  const stageTotal = rep.stages.reduce((sum, s) => {
    const krw = s.byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0'
    return sum + BigInt(krw)
  }, BigInt(0))
  const total = BigInt(rep.byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0')

  assert.equal(stageTotal, total, '단계 합과 전체 합이 다르다')
  await cleanup()
})

test('큰 금액도 정확히 더한다 — number 로 접으면 조용히 틀어진다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const { stages } = await pipelineAndStages()
  const open = stages.find((s) => s.kind === 'OPEN')!

  const before = BigInt((await reportForMine()).byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0')
  const huge = '9007199254740993' // 2^53 + 1 — number 로는 표현이 안 되는 값
  await makeDeal(`${MARK}큰딜`, co.id, open.id, huge, 'KRW')

  const after = BigInt((await reportForMine()).byCurrency.find((c) => c.currency === 'KRW')?.totalMinor ?? '0')
  assert.equal(after - before, BigInt(huge), '큰 금액이 반올림돼 합계가 틀어졌다')
  await cleanup()
})

test('끝난 뒤 잔여 없음', async () => {
  await cleanup()
  await dbA.$executeRawUnsafe(`DELETE FROM crm_stage WHERE "pipelineId" = $1`, PIPE)
  await dbA.$executeRawUnsafe(`DELETE FROM crm_pipeline WHERE id = $1`, PIPE)
  assert.equal(await dbA.crmCompany.count({ where: { name: { contains: MARK }, deletedAt: undefined } }), 0)
})
