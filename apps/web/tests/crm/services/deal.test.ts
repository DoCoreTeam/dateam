/**
 * 딜 서비스 — 실 DB 검증 (dacrm T1-03)
 *
 * 전이 규칙(DI-06·07·08)과 이력 원자성(DI-09)이 **서비스를 통과할 때** 지켜지는지 본다.
 * 상태 기계 단위 테스트는 이미 있다. 여기서 보는 것은 "서비스가 그걸 실제로 거치는가"다 —
 * 만들어 놓고 안 부르면 규칙은 없는 것과 같다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import {
  createDeal, updateDeal, moveDealStage, closeDeal, deleteDeal, listDeals, getDeal,
} from '../../../lib/crm/services/deal.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MADE: string[] = []
let companyId = ''

async function seedCompany(): Promise<string> {
  if (companyId) return companyId
  const c = await createCompany(WS_A, 'mb_owner', { name: '딜테스트 상사' })
  companyId = c.id
  return companyId
}

async function newDeal(name: string) {
  const cid = await seedCompany()
  const d = await createDeal(WS_A, 'mb_owner', {
    companyId: cid, pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name,
  })
  MADE.push(d.id)
  return d
}

async function cleanup() {
  if (MADE.length) {
    await dbA.crmStageHistory.deleteMany({ where: { dealId: { in: MADE } } })
    await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: MADE } } })
    await dbA.crmDeal.deleteMany({ where: { id: { in: MADE } } })
    MADE.length = 0
  }
  if (companyId) {
    await dbA.crmAuditLog.deleteMany({ where: { targetId: companyId } })
    await dbA.crmCompany.deleteMany({ where: { id: companyId } })
    companyId = ''
  }
}

test('딜을 만들면 첫 진입도 이력에 남는다 (언제 이 단계에 들어왔는지 알아야 한다)', async () => {
  const d = await newDeal('이력 딜')
  const hist = await dbA.crmStageHistory.findMany({ where: { dealId: d.id } })
  assert.equal(hist.length, 1)
  assert.equal(hist[0].fromStageId, null, '첫 진입은 이전 단계가 없다')
  assert.equal(hist[0].toStageId, 'st_gpu_1')
  assert.equal(hist[0].durationSec, null, '첫 진입의 체류 시간은 0 이 아니라 모른다(null)')
  await cleanup()
})

test('DI-05 다른 파이프라인의 단계로는 만들 수 없다', async () => {
  const cid = await seedCompany()
  const e = await catchError(() => createDeal(WS_A, 'mb_owner', {
    companyId: cid, pipelineId: 'pl_gpu', stageId: 'st_kdc_1', name: '잘못된 단계',
  }))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /파이프라인/)
  await cleanup()
})

test('DI-09 단계를 옮기면 딜과 이력이 함께 바뀐다', async () => {
  const d = await newDeal('이동 딜')
  const moved = await moveDealStage(WS_A, 'mb_owner', d.id, { version: d.version, toStageId: 'st_gpu_2' })
  assert.equal(moved.stageId, 'st_gpu_2')

  const hist = await dbA.crmStageHistory.findMany({ where: { dealId: d.id }, orderBy: { movedAt: 'asc' } })
  assert.equal(hist.length, 2, '이동 이력이 안 남았다')
  assert.equal(hist[1].fromStageId, 'st_gpu_1')
  assert.equal(hist[1].toStageId, 'st_gpu_2')
  assert.ok(typeof hist[1].durationSec === 'number', '두 번째 이동은 체류 시간을 안다')
  await cleanup()
})

test('같은 단계로 옮기면 이력을 만들지 않는다 (체류 시간이 잘게 쪼개지지 않게)', async () => {
  const d = await newDeal('제자리 딜')
  await moveDealStage(WS_A, 'mb_owner', d.id, { version: d.version, toStageId: 'st_gpu_1' })
  const hist = await dbA.crmStageHistory.count({ where: { dealId: d.id } })
  assert.equal(hist, 1, '제자리 이동이 이력으로 남았다')
  await cleanup()
})

test('단계 이동을 일반 수정으로 하려 하면 막고 이유를 말한다', async () => {
  const d = await newDeal('우회 딜')
  const e = await catchError(() =>
    updateDeal(WS_A, 'mb_owner', d.id, { version: d.version, stageId: 'st_gpu_2' }))
  assert.ok(e instanceof CrmError, '우회로가 열려 있으면 이력 없는 이동이 생긴다')
  assert.match((e as CrmError).message, /이력/)
  await cleanup()
})

test('DI-06 WON 은 금액 없이 못 간다', async () => {
  const d = await newDeal('금액없는 성사')
  const e = await catchError(() =>
    closeDeal(WS_A, 'mb_owner', d.id, { version: d.version, to: 'WON', wonAt: '2026-08-16' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'INVALID_TRANSITION')
  assert.equal((await getDeal(dbA, d.id)).status, 'OPEN', '실패했는데 상태가 바뀌었다')
  await cleanup()
})

test('DI-06 금액과 성사일이 있으면 WON 이 된다', async () => {
  const d = await newDeal('정상 성사')
  const won = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: '300000000', currency: 'KRW',
  })
  assert.equal(won.status, 'WON')
  assert.equal(won.amountMinor, BigInt('300000000'))
  assert.ok(won.wonAt)
  await cleanup()
})

test('DI-07 LOST 는 사유 없이 못 간다', async () => {
  const d = await newDeal('사유없는 실주')
  const e = await catchError(() =>
    closeDeal(WS_A, 'mb_owner', d.id, { version: d.version, to: 'LOST' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'INVALID_TRANSITION')

  const ok = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'LOST', reason: '가격 경쟁력 부족',
  })
  assert.equal(ok.status, 'LOST')
  assert.equal(ok.lostReason, '가격 경쟁력 부족')
  await cleanup()
})

test('DI-08 WON 에서 LOST 로 바로 못 간다 — 재오픈을 거쳐야 흔적이 남는다', async () => {
  const d = await newDeal('전이 딜')
  const won = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: '1000000',
  })

  const e = await catchError(() =>
    closeDeal(WS_A, 'mb_owner', d.id, { version: won.version, to: 'LOST', reason: '취소' }))
  assert.ok(e instanceof CrmError, 'WON 에서 LOST 로 바로 갔다')
  assert.equal((e as CrmError).code, 'INVALID_TRANSITION')

  // 재오픈을 거치면 갈 수 있다
  const reopened = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: won.version, to: 'OPEN', reason: '계약 무산으로 재검토',
  })
  assert.equal(reopened.status, 'OPEN')
  assert.equal(reopened.wonAt, null, '재오픈했는데 성사일이 남았다')

  const lost = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: reopened.version, to: 'LOST', reason: '최종 무산',
  })
  assert.equal(lost.status, 'LOST')

  // 흔적이 감사 로그에 남는다
  const actions = (await dbA.crmAuditLog.findMany({
    where: { targetId: d.id }, orderBy: { createdAt: 'asc' },
  })).map((r: { action: string }) => r.action)
  assert.deepEqual(
    actions.filter((a: string) => a.startsWith('deal.')),
    ['deal.created', 'deal.won', 'deal.reopened', 'deal.lost'],
  )
  await cleanup()
})

test('재오픈도 사유가 필요하다', async () => {
  const d = await newDeal('사유없는 재오픈')
  const won = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: '500000',
  })
  const e = await catchError(() =>
    closeDeal(WS_A, 'mb_owner', d.id, { version: won.version, to: 'OPEN' }))
  assert.ok(e instanceof CrmError)
  await cleanup()
})

test('금액은 2^53 을 넘어도 정확하다 (문자열로 받는 이유)', async () => {
  const d = await newDeal('큰 금액 딜')
  const big = '9007199254740993' // 2^53 + 1
  const won = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: big,
  })
  assert.equal(won.amountMinor?.toString(), big, 'number 로 받으면 여기서 값이 틀어진다')
  await cleanup()
})

test('음수 금액은 막는다', async () => {
  const cid = await seedCompany()
  const e = await catchError(() => createDeal(WS_A, 'mb_owner', {
    companyId: cid, pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: '음수', amountMinor: '-1',
  }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  await cleanup()
})

test('보드는 열린 딜만 골라 볼 수 있다', async () => {
  const open = await newDeal('열린 딜')
  const closing = await newDeal('닫힐 딜')
  await closeDeal(WS_A, 'mb_owner', closing.id, {
    version: closing.version, to: 'LOST', reason: '보드 제외 확인',
  })

  const page = await listDeals(dbA, { pipelineId: 'pl_gpu', status: 'OPEN', limit: 100 })
  const ids = page.items.map((r) => r.id)
  assert.ok(ids.includes(open.id))
  assert.equal(ids.includes(closing.id), false, '닫힌 딜이 보드에 남았다')
  await cleanup()
})

test('딜을 휴지통에 넣으면 목록에서 빠진다', async () => {
  const d = await newDeal('삭제될 딜')
  await deleteDeal(WS_A, 'mb_owner', d.id, 'trash')
  const page = await listDeals(dbA, { q: '삭제될 딜' })
  assert.equal(page.items.some((r) => r.id === d.id), false)
  await cleanup()
})

test('성사로 확정하면 단계도 함께 옮겨진다 (실브라우저에서 잡은 결함)', async () => {
  // 상태만 바꾸고 단계를 두면 **카드가 원래 자리에 남는다.**
  // 사용자는 수주 칸으로 옮겼는데 화면은 견적·제안에 그대로였다.
  const d = await newDeal('칸 이동 성사')
  const won = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: '1000000',
    toStageId: 'st_gpu_6', // 수주 칸
  })
  assert.equal(won.status, 'WON')
  assert.equal(won.stageId, 'st_gpu_6', '상태만 바뀌고 단계가 안 옮겨졌다')

  // 이동 이력도 함께 남는다(DI-09)
  const hist = await dbA.crmStageHistory.findMany({
    where: { dealId: d.id }, orderBy: { movedAt: 'asc' },
  })
  assert.equal(hist.length, 2)
  assert.equal(hist[1].toStageId, 'st_gpu_6')
  await cleanup()
})

test('실주도 단계를 함께 옮긴다', async () => {
  const d = await newDeal('칸 이동 실주')
  const lost = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'LOST', reason: '예산 미확보', toStageId: 'st_gpu_7',
  })
  assert.equal(lost.status, 'LOST')
  assert.equal(lost.stageId, 'st_gpu_7')
  await cleanup()
})

test('toStageId 를 안 주면 단계는 그대로다 (보드 밖 호출 호환)', async () => {
  const d = await newDeal('단계 유지 성사')
  const won = await closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: '1000000',
  })
  assert.equal(won.stageId, d.stageId)
  await cleanup()
})

test('다른 파이프라인 칸으로는 확정할 수 없다 (DI-05)', async () => {
  const d = await newDeal('잘못된 칸 성사')
  const e = await catchError(() => closeDeal(WS_A, 'mb_owner', d.id, {
    version: d.version, to: 'WON', wonAt: '2026-08-16', amountMinor: '1000000',
    toStageId: 'st_kdc_1',
  }))
  assert.ok(e instanceof CrmError)
  assert.equal((await getDeal(dbA, d.id)).status, 'OPEN', '실패했는데 상태가 바뀌었다')
  await cleanup()
})
