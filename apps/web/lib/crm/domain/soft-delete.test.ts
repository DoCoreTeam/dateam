import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planDelete, purgeAfter, daysLeftInTrash, isPurgeDue, describeDelete,
  TRASH_RETENTION_DAYS,
} from './soft-delete.ts'

const NOW = new Date('2026-08-16T00:00:00Z')

test('기본은 휴지통이고 되돌릴 수 있다', () => {
  const p = planDelete('trash')
  assert.equal(p.reversible, true)
  assert.equal(p.auditAction, 'record.trashed')
})

test('영구 삭제는 되돌릴 수 없고 감사 action 이 다르다', () => {
  const p = planDelete('purge')
  assert.equal(p.reversible, false)
  assert.equal(p.auditAction, 'record.purged')
})

test(`휴지통 보관은 ${TRASH_RETENTION_DAYS}일이다 (통합기획서 473·616행)`, () => {
  assert.equal(purgeAfter(NOW).toISOString(), '2026-09-15T00:00:00.000Z')
  assert.equal(daysLeftInTrash(NOW, NOW), TRASH_RETENTION_DAYS)
})

test('보관 기간이 지나면 정리 대상이다', () => {
  assert.equal(isPurgeDue(NOW, new Date('2026-09-14T00:00:00Z')), false)
  assert.equal(isPurgeDue(NOW, new Date('2026-09-15T00:00:00Z')), true)
  assert.equal(isPurgeDue(NOW, new Date('2026-10-01T00:00:00Z')), true)
})

test('확인창은 사라지는 것과 남는 것을 둘 다 말한다', () => {
  // 남는 것을 안 밝히면 사용자는 전부 없어지는 줄 알고 못 지운다(CI 실측)
  const d = describeDelete(planDelete('purge'), {
    removed: ['연결된 활동 12건'],
    kept: ['딜 3건은 유지됩니다'],
  })
  assert.ok(d.body.some((l) => l.includes('함께 삭제됩니다')), '사라지는 것을 안 밝혔다')
  assert.ok(d.body.some((l) => l.includes('그대로 남습니다')), '남는 것을 안 밝혔다')
})

test('영구 삭제 확인창은 되돌릴 수 없음을 분명히 말한다', () => {
  const d = describeDelete(planDelete('purge'), { removed: [], kept: [] })
  assert.equal(d.title, '영구히 삭제할까요?')
  assert.equal(d.confirmLabel, '영구 삭제')
  assert.ok(d.body.some((l) => l.includes('되돌릴 수 없습니다')))
})

test('휴지통 확인창은 복구 기간을 알려 준다', () => {
  const d = describeDelete(planDelete('trash'), { removed: [], kept: [] })
  assert.equal(d.title, '휴지통으로 보낼까요?')
  assert.equal(d.confirmLabel, '휴지통으로')
  assert.ok(d.body.some((l) => l.includes(`${TRASH_RETENTION_DAYS}일`)))
})

test('영향이 없으면 빈 줄을 만들지 않는다', () => {
  const d = describeDelete(planDelete('trash'), { removed: [], kept: [] })
  assert.equal(d.body.length, 1, '영향 없는데 빈 문장이 붙었다')
})
