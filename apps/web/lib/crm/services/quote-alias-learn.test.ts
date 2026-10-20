import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readText } from '../domain/quote-text/read-rules.ts'
import { cleanCandidates, learnAliases, MAX_ALIASES_PER_ITEM, nextAliases } from './quote-alias-learn.ts'

test('이름과 같은 말과 이미 있는 별칭은 안 더한다, 같은 말 두 번이면 한 번', () => {
  assert.deepEqual(nextAliases('H100 서버', ['에이치백'], ['에이치백', 'h100서버', '에치백', '에치백']), ['에이치백', '에치백'])
  assert.equal(nextAliases('H100 서버', ['에이치백'], ['에이치 백']), null)
})

test('별칭은 품목마다 상한까지', () => {
  const many = Array.from({ length: 30 }, (_, i) => `별칭${i}`)
  assert.equal(nextAliases('품목', [], many)?.length, MAX_ALIASES_PER_ITEM)
})

test('모양이 틀린 후보는 버린다', () => {
  assert.deepEqual(cleanCandidates([{ itemId: 'a', word: '에' }, { itemId: '', word: '에이치백' }, { itemId: 'a', word: 'x'.repeat(41) }, 'x', { itemId: 'a', word: ' 에이치백 ' }]), [{ itemId: 'a', word: '에이치백' }])
  assert.deepEqual(cleanCandidates(null), [])
})

test('저장하면 별칭이 남고 다음 글에서 규칙이 읽는다', async () => {
  const store = [{ id: 'h100', name: 'H100 서버', aliases: [] as string[] }]
  const tx = {
    crmProduct: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => store.filter((s) => where.id.in.includes(s.id)),
      update: async ({ where, data }: { where: { id: string }; data: { aliases: string[] } }) => {
        const row = store.find((s) => s.id === where.id)!
        row.aliases = data.aliases
      },
    },
  }
  const before = readText('에이치백 두 대', { products: [], items: store })
  assert.equal(before[0].unread, true)
  assert.equal(await learnAliases(tx, [{ itemId: 'h100', word: '에이치백' }, { itemId: 'nope', word: '없는 품목' }]), 1)
  assert.equal(await learnAliases(tx, [{ itemId: 'h100', word: '에이치백' }]), 0)
  const after = readText('에이치백 두 대', { products: [], items: store })
  assert.deepEqual(after[0].itemIds, ['h100'])
})

test('견적 만들기와 고치기 둘 다 별칭 학습을 부른다', () => {
  const src = readFileSync(new URL('./quote.ts', import.meta.url), 'utf8')
  assert.equal(src.match(/await learnAliases\(tx, input\.learnedAliases\)/g)?.length, 2)
})
