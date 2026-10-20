import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dir = new URL('../../../app/(crm)/crm/products/[id]/', import.meta.url)
const info = readFileSync(new URL('InfoTab.tsx', dir), 'utf8')
const preview = readFileSync(new URL('PreviewTab.tsx', dir), 'utf8')

test('견적에 안 쓰이는 총비용 칸은 기본 정보에 없고 미리 계산의 총비용 줄 아래에 있다', () => {
  assert.doesNotMatch(info, /tcoYears|freeYears|pi-tco|pi-free/)
  assert.match(preview, /<TcoSettings data=\{data\} onSaved=\{onSaved\} \/>/)
  assert.ok(preview.indexOf('previewTco(') < preview.indexOf('<TcoSettings'))
})

test('묶음 이름을 바꾸면 원래 이름과 함께 보낸다 — 서버가 품목과 규칙까지 따라 고친다', () => {
  assert.match(info, /sectionRenames: form\.sections\.filter\(\(x\) => x\.orig && x\.orig !== x\.name\.trim\(\)\)/)
  assert.match(info, /disabled=\{busy !== null \|\| used > 0\}/, '품목이 남은 묶음은 지우기를 막는다')
  assert.match(info, /nameClash/, '빈 이름과 겹친 이름은 저장을 막는다')
  assert.match(info, /!e\.nativeEvent\.isComposing/, '한글 조합 중 엔터로 더하지 않는다')
})
