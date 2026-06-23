import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToStructuredText } from './html-table-extract.ts'

test('빈/비문자열 입력은 빈 문자열', () => {
  assert.equal(htmlToStructuredText(''), '')
  // @ts-expect-error 런타임 가드 검증
  assert.equal(htmlToStructuredText(null), '')
  // @ts-expect-error 런타임 가드 검증
  assert.equal(htmlToStructuredText(undefined), '')
})

test('표는 행=줄바꿈, 셀=" | "로 보존', () => {
  const html = `
    <table>
      <tr><th>Model</th><th>VRAM</th><th>Price</th></tr>
      <tr><td>H100</td><td>80GB</td><td>$1.99</td></tr>
      <tr><td>A100</td><td>40GB</td><td>$1.10</td></tr>
    </table>`
  const out = htmlToStructuredText(html)
  const lines = out.split('\n')
  assert.equal(lines[0], 'Model | VRAM | Price')
  assert.equal(lines[1], 'H100 | 80GB | $1.99')
  assert.equal(lines[2], 'A100 | 40GB | $1.10')
})

test('빈 셀도 자리를 유지(열 정렬 보존)', () => {
  const html = `<table>
    <tr><td>H100</td><td></td><td>$1.99</td></tr>
  </table>`
  const out = htmlToStructuredText(html)
  assert.equal(out, 'H100 |  | $1.99')
})

test('"Contact us"·"—" 같은 모호행도 살아남는다', () => {
  const html = `<table>
    <tr><td>Model</td><td>Price</td></tr>
    <tr><td>B200</td><td>Contact us</td></tr>
    <tr><td>GH200</td><td>—</td></tr>
  </table>`
  const out = htmlToStructuredText(html)
  assert.ok(out.includes('B200 | Contact us'))
  assert.ok(out.includes('GH200 | —'))
})

test('표 밖 텍스트는 평문화', () => {
  const html = `<h1>GPU Pricing</h1><p>Updated daily.</p>
    <table><tr><td>L4</td><td>$0.50</td></tr></table>
    <p>Contact sales for volume.</p>`
  const out = htmlToStructuredText(html)
  assert.ok(out.includes('GPU Pricing'))
  assert.ok(out.includes('Updated daily.'))
  assert.ok(out.includes('L4 | $0.50'))
  assert.ok(out.includes('Contact sales for volume.'))
})

test('script/style/nav/footer 제거', () => {
  const html = `<nav>menu</nav><script>var x=1</script><style>.a{}</style>
    <p>real</p><footer>copyright</footer>`
  const out = htmlToStructuredText(html)
  assert.ok(out.includes('real'))
  assert.ok(!out.includes('menu'))
  assert.ok(!out.includes('var x'))
  assert.ok(!out.includes('copyright'))
})

test('HTML 엔티티 디코드', () => {
  const html = `<p>A&amp;B &lt;tag&gt; &nbsp;end</p>`
  const out = htmlToStructuredText(html)
  assert.ok(out.includes('A&B'))
  assert.ok(out.includes('<tag>'))
})

test('다중 표 모두 보존', () => {
  const html = `<table><tr><td>A</td></tr></table>
    <p>between</p>
    <table><tr><td>B</td></tr></table>`
  const out = htmlToStructuredText(html)
  assert.ok(out.includes('A'))
  assert.ok(out.includes('between'))
  assert.ok(out.includes('B'))
})
