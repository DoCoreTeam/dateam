import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { arrange, moveToSection, reorderSection, type ArrangeItem } from './price-items-arrange.ts'

const SECS = ['라이선스', '구축비']
const ITEMS: ArrangeItem[] = [
  { id: 'a', section: '라이선스', position: 0 }, { id: 'b', section: '라이선스', position: 1 },
  { id: 'c', section: '구축비', position: 2 }, { id: 'd', section: '구축비', position: 3 },
]
const view = (rs: ArrangeItem[]) => rs.map((r) => `${r.id}:${r.section}:${r.position}`)

test('묶음 순서대로 펼치고 위치를 0부터 다시 매긴다', () => {
  assert.deepEqual(view(arrange([...ITEMS].reverse(), SECS)), ['a:라이선스:0', 'b:라이선스:1', 'c:구축비:2', 'd:구축비:3'])
})

test('다른 묶음으로 옮기면 그 묶음 끝에 선다', () => {
  assert.deepEqual(view(moveToSection(ITEMS, 'a', '구축비', SECS)), ['b:라이선스:0', 'c:구축비:1', 'd:구축비:2', 'a:구축비:3'])
})

test('한 묶음 안 순서를 바꿔도 다른 묶음은 그대로', () => {
  assert.deepEqual(view(reorderSection(ITEMS, '구축비', ['d', 'c'], SECS)), ['a:라이선스:0', 'b:라이선스:1', 'd:구축비:2', 'c:구축비:3'])
})

test('끌 때 품목 id 를 싣고 묶음 칸이 받는다, 키보드로는 묶음 고르기, 창구 둘을 부른다', () => {
  const dir = new URL('../../../app/(crm)/crm/products/[id]/', import.meta.url)
  const board = readFileSync(new URL('ItemsBoard.tsx', dir), 'utf8')
  assert.match(board, /e\.dataTransfer\.setData\(DRAG_TYPE, r\.id\)/)
  assert.match(board, /onDrop=\{\(e\) => onDrop\(e, sec\.name\)\}/)
  assert.match(board, /aria-label=\{`\$\{r\.name\} \$\{PRICEBOOK\.moveTo\}`\}/)
  const tab = readFileSync(new URL('ItemsTab.tsx', dir), 'utf8')
  assert.match(tab, /\/items\/order`/)
  assert.match(tab, /\/api\/crm\/pricebook\/items\/\$\{id\}\/action`/)
  assert.match(tab, /useBulkAction\(/)
  for (const r of ['products/[id]/items/order/route.ts', 'items/[id]/action/route.ts']) {
    assert.match(readFileSync(new URL(`../../../app/api/crm/pricebook/${r}`, import.meta.url), 'utf8'), /withCrmApi\('ADMIN'/)
  }
})
