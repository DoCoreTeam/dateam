import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractArtifacts,
  buildArtifactVersions,
  extForLanguage,
} from './artifacts.ts'

// 15줄짜리 코드 펜스 생성 헬퍼
function codeFence(lang: string, lines: number, firstLine?: string): string {
  const body: string[] = []
  if (firstLine) body.push(firstLine)
  while (body.length < lines) body.push(`const x${body.length} = ${body.length}`)
  return '```' + lang + '\n' + body.join('\n') + '\n```'
}

test('승격 경계: 14줄 코드는 인라인 유지(미승격), 15줄은 승격', () => {
  const under = extractArtifacts(codeFence('js', 14))
  assert.equal(under.length, 0)
  const over = extractArtifacts(codeFence('js', 15))
  assert.equal(over.length, 1)
  assert.equal(over[0].type, 'code')
})

test('승격 경계: 800자 이상이면 줄 수 미달이어도 승격', () => {
  const longLine = 'x'.repeat(850)
  const md = '```js\n' + longLine + '\n```'
  const out = extractArtifacts(md)
  assert.equal(out.length, 1)
  assert.equal(out[0].content.length, 850)
})

test('html/svg/mermaid는 짧아도 무조건 승격', () => {
  assert.equal(extractArtifacts('```html\n<div>hi</div>\n```').length, 1)
  assert.equal(extractArtifacts('```svg\n<svg></svg>\n```').length, 1)
  assert.equal(extractArtifacts('```mermaid\ngraph TD\nA-->B\n```').length, 1)
  assert.equal(extractArtifacts('```html\n<div>hi</div>\n```')[0].type, 'html')
})

test('markdown/md는 10줄 이상일 때만 문서 artifact로 승격', () => {
  const nine = '```md\n' + Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n') + '\n```'
  assert.equal(extractArtifacts(nine).length, 0)
  const ten = '```markdown\n' + Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n```'
  const out = extractArtifacts(ten)
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'markdown')
})

test('인라인 코드/열린 펜스는 제외', () => {
  assert.equal(extractArtifacts('here is `inline code` only').length, 0)
  // 닫히지 않은 펜스
  assert.equal(extractArtifacts('```js\n' + 'a\n'.repeat(20)).length, 0)
})

test('title 추론: 파일명 주석 우선(// file.ts, # file.py, <!-- file.html -->)', () => {
  const ts = extractArtifacts(codeFence('ts', 15, '// app.ts'))
  assert.equal(ts[0].title, 'app.ts')
  const py = extractArtifacts(codeFence('python', 15, '# main.py'))
  assert.equal(py[0].title, 'main.py')
  const html = extractArtifacts('```html\n<!-- index.html -->\n<div>x</div>\n```')
  assert.equal(html[0].title, 'index.html')
})

test('title 추론: 파일명 주석 없으면 직전 헤딩 사용', () => {
  const md = '## My Component\n\n' + codeFence('js', 15)
  const out = extractArtifacts(md)
  // sanitize: 공백 제거 → 'MyComponent'
  assert.equal(out[0].title, 'MyComponent')
})

test('title 추론: 파일명/헤딩 없으면 언어+순번', () => {
  const out = extractArtifacts(codeFence('js', 15))
  assert.equal(out[0].title, 'js-1')
})

test('title sanitize: [^\\w.\\-] 제거 + 경로 basename', () => {
  const out = extractArtifacts(codeFence('ts', 15, '// src/features/app.ts'))
  assert.equal(out[0].title, 'app.ts') // 슬래시 경로 → basename
})

test('buildArtifactVersions: 동일 identity 재등장 = 버전 그룹(시간순)', () => {
  const v1 = codeFence('ts', 15, '// app.ts')
  const v2 = codeFence('ts', 16, '// app.ts')
  const other = codeFence('py', 15, '# other.py')
  const messages = [
    { id: 'm1', content: v1, createdAt: '2026-01-01T00:00:01Z' },
    { id: 'm2', content: other, createdAt: '2026-01-01T00:00:02Z' },
    { id: 'm3', content: v2, createdAt: '2026-01-01T00:00:03Z' },
  ]
  const map = buildArtifactVersions(messages)
  const appVersions = map.get('code:app.ts')
  assert.ok(appVersions)
  assert.equal(appVersions!.length, 2)
  assert.deepEqual(appVersions!.map((v) => v.messageId), ['m1', 'm3'])
  assert.equal(map.get('code:other.py')!.length, 1)
})

test('extForLanguage: 등록 매핑 + 미등록 폴백', () => {
  assert.equal(extForLanguage('typescript'), 'ts')
  assert.equal(extForLanguage('HTML'), 'html')
  assert.equal(extForLanguage('python'), 'py')
  assert.equal(extForLanguage('unknownlang'), 'txt')
  assert.equal(extForLanguage('mermaid'), 'mmd')
})
