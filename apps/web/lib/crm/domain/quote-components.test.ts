/**
 * 합쳐져 온 구성 되살리기 가드
 *
 * **왜 필요한가**: 지시를 또렷하게 써도 모델은 가끔 구성 열세 줄을 규격 한 칸에 이어 붙인다.
 * 그러면 견적서에 한 문단으로 쭉 이어져 어디서 끊기는지 사람이 못 읽는다
 * (사용자 지적 2026-09-21: 「그냥 한문장으로 쭉있는것 같자나」).
 *
 * **지어내면 안 된다.** 되가르는 것은 원문과 글자가 정확히 맞아떨어질 때뿐이다 —
 * 원문에 없던 줄바꿈을 우리가 만들면 그 문서가 그대로 고객에게 나간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resplitSpec, restoreComponents } from './quote-components.ts'

/** 실제 그 견적서의 모양 — 섀시 한 줄 아래 사양이 줄마다 나뉜다 */
const SOURCE = [
  '--- 1쪽 ---',
  '품목 상세내역 수량 소비자가격 제안가',
  'GIGABYTE G494-ZB4-AAP2 AMD 9655 2.6GHz/96Core x 2Ea, 1024GB Mem 1 17,600,000',
  'HPC/AI Server - AMD EPYC 9005/9004 - 4U DP 8 x PCIe GPUs',
  'Supports up to 8 x Dual slot Gen5 GPUs',
  'Dual AMD EPYC 9005/9004 Series Processors',
  'CPU AMD EPYC 9655 (96C/192T) 2 17,600,000',
]

test('★ 합쳐진 규격을 원문 줄 경계로 되가른다 — 이게 없으면 견적서가 한 문단이 된다', () => {
  const merged = 'AMD 9655 2.6GHz/96Core x 2Ea, 1024GB Mem 1 17,600,000'
    + ' HPC/AI Server - AMD EPYC 9005/9004 - 4U DP 8 x PCIe GPUs'
    + ' Supports up to 8 x Dual slot Gen5 GPUs'
  const got = resplitSpec(merged, SOURCE)
  assert.ok(got, '되가르지 못했다')
  assert.equal(got.components.length, 2, '구성 두 줄이 안 갈렸다')
  assert.equal(got.components[0], 'HPC/AI Server - AMD EPYC 9005/9004 - 4U DP 8 x PCIe GPUs')
})

test('★ 원문 줄 셋이 합쳐져 왔으면 셋으로 갈린다', () => {
  const lines = [
    'AMD 9655 2.6GHz/96Core x 2Ea, 1024GB Mem',
    'HPC/AI Server - AMD EPYC 9005/9004 - 4U DP 8 x PCIe GPUs',
    'Supports up to 8 x Dual slot Gen5 GPUs',
  ]
  const got = resplitSpec(lines.join(' '), ['머리글', ...lines, '다음 항목'])
  assert.deepEqual(got, { spec: lines[0], components: lines.slice(1) })
})

test('★ 한 글자라도 어긋나면 손대지 않는다 — 원문에 없던 줄바꿈을 지어내지 않는다', () => {
  const lines = ['가나다라', '마바사아']
  assert.equal(resplitSpec('가나다라 마바사아 자차카타', lines), null, '원문에 없는 말이 붙었는데 갈랐다')
  assert.equal(resplitSpec('가나다라 마바사', lines), null, '글자가 다른데 갈랐다')
  assert.equal(resplitSpec('', lines), null)
  assert.equal(resplitSpec('가나다라 마바사아', []), null, '원문이 없는데 갈랐다')
})

test('한 줄짜리는 되가를 것이 없다 — 애초에 합쳐진 것이 아니다', () => {
  assert.equal(resplitSpec('가나다라', ['가나다라', '마바사아']), null)
})

test('공백 차이는 무시한다 — 문서마다 띄어쓰기가 다르다', () => {
  const got = resplitSpec('가나 다라  마바   사아', ['가나 다라', '마바 사아'])
  assert.deepEqual(got, { spec: '가나 다라', components: ['마바 사아'] })
})

test('★ 모델이 이미 나눠 줬으면 건드리지 않는다 — 옳게 나눈 것을 되돌리면 안 된다', () => {
  const line = { spec: '가나다라', components: ['이미 나뉜 줄'] }
  assert.equal(restoreComponents(line, ['가나다라', '마바사아']), line)
})

test('★ 되살릴 수 있으면 항목이 그대로 바뀌어 나온다 — 값이 나오는 단정', () => {
  const line = { spec: '가나다라 마바사아', components: [] as string[], name: 'H100' }
  const got = restoreComponents(line, ['머리글', '가나다라', '마바사아'])
  assert.equal(got.spec, '가나다라')
  assert.deepEqual(got.components, ['마바사아'])
  assert.equal(got.name, 'H100', '다른 칸이 사라졌다')
})

test('원문이 없으면(그림째 읽은 경우) 손대지 않는다', () => {
  const line = { spec: '가나다라 마바사아', components: [] as string[] }
  assert.equal(restoreComponents(line, []), line)
})
