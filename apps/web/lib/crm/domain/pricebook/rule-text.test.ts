import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRule } from './rule-text.ts'
import { GCUBE_EDGE } from './gcube-edge.ts'

const nameOf = (id: string) => GCUBE_EDGE.items.find((i) => i.id === id)?.name ?? null

test('gcube edge 규칙이 모두 문장이 된다 — 빈 문장 없음, 없는 품목 없음', () => {
  for (const r of GCUBE_EDGE.rules) {
    const t = describeRule(r, nameOf)
    assert.ok(t.length > 5, r.kind)
    assert.ok(!t.includes('없는 품목'), t)
  }
})

test('대표 문장', () => {
  assert.equal(describeRule(GCUBE_EDGE.rules[0], nameOf), 'STD 기본 금액, ENT 기본 금액 가운데 하나만 고른다')
  assert.equal(describeRule({ kind: 'CAP', item: 'edge-std', varKey: 'gpu.total', max: 300 }, nameOf), 'STD 기본 금액은 GPU 합계 300까지')
  assert.match(describeRule({ kind: 'DISCOUNT', companyKind: 'school', pct: 10, confirmed: false, label: '교육기관' }, nameOf), /학교.*교육기관 10% \(제안값\)/)
})

test('없는 품목을 가리키면 그 사실을 문장에 적는다', () => {
  assert.match(describeRule({ kind: 'WITH', item: 'ghost', with: [] }, nameOf), /없는 품목\(ghost\)/)
})

test('전환 규칙을 한 줄로 말하고, 모양이 틀리면 짚는다', async () => {
  const { checkRules } = await import('./validate.ts')
  const { GCUBE_EDGE } = await import('./gcube-edge.ts')
  const nameOf = (id: string) => GCUBE_EDGE.items.find((i) => i.id === id)?.name ?? null
  assert.equal(describeRule({ kind: 'UPGRADE', item: 'edge-ent-switch', from: 'edge-std', to: 'edge-ent' }, nameOf),
    'STD 기본 금액을 산 고객이 ENT 기본 금액을 고르면 ENT 전환 구축이 들어간다')
  assert.deepEqual(checkRules(GCUBE_EDGE), [])
  const bad = { ...GCUBE_EDGE, rules: [{ kind: 'UPGRADE' as const, item: 'edge-ent-switch', from: 'edge-std', to: 'edge-std' }] }
  assert.ok(checkRules(bad).some((p) => /다른 품목/.test(p.message)))
  const sql = (await import('node:fs')).readFileSync(new URL('../../../../../../supabase/migrations/313_crm_price_rule_upgrade.sql', import.meta.url), 'utf8')
  assert.match(sql, /'SCALE_CAP', 'UPGRADE'\)/)
})
