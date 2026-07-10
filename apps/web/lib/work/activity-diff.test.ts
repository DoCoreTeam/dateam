import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatFieldValue, diffSnapshots, diffWeeklyRows } from './activity-diff.ts'

test('formatFieldValue: 우선순위/상태/진행률/불리언 자연어화', () => {
  assert.equal(formatFieldValue('priority', 'high'), '높음')
  assert.equal(formatFieldValue('priority', 'urgent'), '긴급')
  assert.equal(formatFieldValue('entry_type', 'done'), '완료')
  assert.equal(formatFieldValue('status', 'active'), '진행중')
  assert.equal(formatFieldValue('progress', 40), '40%')
  assert.equal(formatFieldValue('is_resolved', true), '예')
  assert.equal(formatFieldValue('is_resolved', false), '아니오')
})

test('formatFieldValue: 값 없음은 없음', () => {
  assert.equal(formatFieldValue('content', null), '없음')
  assert.equal(formatFieldValue('content', ''), '없음')
  assert.equal(formatFieldValue('target_date', undefined), '없음')
})

test('formatFieldValue: 체크리스트는 완료마크+라벨', () => {
  const v = [{ done: false, label: '시민앱 구현 방안 제안' }, { done: true, label: '검토' }]
  assert.equal(formatFieldValue('checklist', v), '○ 시민앱 구현 방안 제안, ✓ 검토')
  assert.equal(formatFieldValue('checklist', []), '없음')
})

test('formatFieldValue: HTML 실적은 plain 텍스트(태그 제거)', () => {
  assert.equal(formatFieldValue('performance', '<p>완료<br/>했음</p>'), '완료\n했음')
})

test('diffSnapshots update: 바뀐 필드만 이전→새값', () => {
  const before = { content: '초안', priority: 'normal', progress: 0, user_id: 'x' }
  const after = { content: '초안', priority: 'high', progress: 50, user_id: 'x' }
  const d = diffSnapshots('update', before, after)
  assert.equal(d.length, 2)
  const pr = d.find((c) => c.field === 'priority')!
  assert.deepEqual({ from: pr.from, to: pr.to }, { from: '보통', to: '높음' })
  const pg = d.find((c) => c.field === 'progress')!
  assert.deepEqual({ from: pg.from, to: pg.to }, { from: '0%', to: '50%' })
  // content는 동일 → 제외, 화이트리스트 밖 user_id도 제외
  assert.equal(d.find((c) => c.field === 'content'), undefined)
  assert.equal(d.find((c) => c.field === 'user_id'), undefined)
})

test('diffSnapshots create: 값 있는 필드만 from=null', () => {
  const after = { content: '새 업무', priority: 'high', progress: 0, target_date: null }
  const d = diffSnapshots('create', null, after)
  const content = d.find((c) => c.field === 'content')!
  assert.equal(content.from, null)
  assert.equal(content.to, '새 업무')
  // target_date null → 생략
  assert.equal(d.find((c) => c.field === 'target_date'), undefined)
})

test('diffSnapshots delete: 지워진 값만 to=null', () => {
  const before = { name: '수원시 사업', status: 'active' }
  const d = diffSnapshots('delete', before, null)
  const name = d.find((c) => c.field === 'name')!
  assert.equal(name.to, null)
  assert.equal(name.from, '수원시 사업')
})

test('diffSnapshots: 객체/배열 동일값은 변경 아님', () => {
  const cl = [{ done: false, label: 'a' }]
  const d = diffSnapshots('update', { checklist: cl }, { checklist: [{ done: false, label: 'a' }] })
  assert.equal(d.length, 0)
})

test('diffWeeklyRows: 카테고리행 실적 변경만 이전→새(HTML plain)', () => {
  const before = [{ category: '개발', seq: 0, performance: '<p>초안</p>', plan: '<p>계획</p>', issues: '' }]
  const after = [{ category: '개발', seq: 0, performance: '<p>완료</p>', plan: '<p>계획</p>', issues: '' }]
  const d = diffWeeklyRows(before, after)
  assert.equal(d.length, 1)
  assert.equal(d[0].label, '개발 · 실적')
  assert.equal(d[0].from, '초안')
  assert.equal(d[0].to, '완료')
})

test('diffWeeklyRows: 추가된 카테고리행은 from=null, 사라진 행은 to=null', () => {
  const added = diffWeeklyRows([], [{ category: '영업', seq: 0, performance: '<p>신규</p>' }])
  assert.equal(added[0].from, null)
  assert.equal(added[0].to, '신규')
  const removed = diffWeeklyRows([{ category: '영업', seq: 0, performance: '<p>구</p>' }], [])
  assert.equal(removed[0].from, '구')
  assert.equal(removed[0].to, null)
})

test('diffWeeklyRows: 변경 없으면 빈 배열', () => {
  const rows = [{ category: '개발', seq: 0, performance: '<p>x</p>', plan: '', issues: '' }]
  assert.equal(diffWeeklyRows(rows, [{ category: '개발', seq: 0, performance: '<p>x</p>', plan: '', issues: '' }]).length, 0)
})
