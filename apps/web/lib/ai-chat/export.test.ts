import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  conversationToMarkdown,
  conversationToPlainText,
  conversationToHtmlDocument,
  escapeHtml,
  sanitizeFilename,
} from './export.ts'

const conv = {
  title: '내 대화',
  provider: 'claude',
  model: 'claude-opus-4-8',
  createdAt: '2026-07-13T05:30:00Z', // KST 14:30
}

test('제목 h1 + provider/model/KST 일시 메타 포함', () => {
  const md = conversationToMarkdown(conv, [])
  assert.ok(md.startsWith('# 내 대화'))
  assert.ok(md.includes('provider: claude'))
  assert.ok(md.includes('model: claude-opus-4-8'))
  assert.ok(md.includes('7/13 14:30')) // formatKstDateTimeShort (KST +9)
})

test('👤/🤖 섹션 반복', () => {
  const md = conversationToMarkdown(conv, [
    { role: 'user', content: '안녕', createdAt: '2026-07-13T05:30:00Z' },
    { role: 'assistant', content: '반가워요', createdAt: '2026-07-13T05:30:05Z' },
  ])
  assert.ok(md.includes('## 👤 사용자'))
  assert.ok(md.includes('## 🤖 어시스턴트'))
  assert.ok(md.indexOf('## 👤 사용자') < md.indexOf('## 🤖 어시스턴트'))
})

test('코드펜스 원문 보존(이스케이프 없음)', () => {
  const code = '```ts\nconst x = 1\nconsole.log(x)\n```'
  const md = conversationToMarkdown(conv, [
    { role: 'assistant', content: `설명\n${code}`, createdAt: '2026-07-13T05:30:05Z' },
  ])
  assert.ok(md.includes(code), '코드펜스가 원문 그대로 보존되어야 함')
})

test('citations 각주 목록 렌더', () => {
  const md = conversationToMarkdown(conv, [
    {
      role: 'assistant',
      content: '답변',
      createdAt: '2026-07-13T05:30:05Z',
      citations: [
        { url: 'https://a.com', title: 'A 사이트' },
        { url: 'https://b.com', title: 'B 사이트' },
      ],
    },
  ])
  assert.ok(md.includes('**출처**'))
  assert.ok(md.includes('1. [A 사이트](https://a.com)'))
  assert.ok(md.includes('2. [B 사이트](https://b.com)'))
})

test('citations 없으면 출처 섹션 미출력', () => {
  const md = conversationToMarkdown(conv, [
    { role: 'user', content: '질문', createdAt: '2026-07-13T05:30:00Z' },
  ])
  assert.ok(!md.includes('**출처**'))
})

test('sanitizeFilename: 위험 문자 제거 + 폴백', () => {
  assert.equal(sanitizeFilename('내 대화 / 2026'), '내_대화_2026')
  assert.equal(sanitizeFilename('a/b\\c:d*e?'), 'a_b_c_d_e')
  assert.equal(sanitizeFilename('   '), 'conversation')
  assert.equal(sanitizeFilename(''), 'conversation')
  // 경로 탈출/구분자 문자가 남지 않아야 함
  const out = sanitizeFilename('../../etc/passwd')
  assert.ok(!out.includes('/'))
  assert.ok(!out.includes('\\'))
})

// ── conversationToPlainText (.txt export) ──
test('plain text: 제목 + provider/model/일시 메타 + 역할 라벨', () => {
  const txt = conversationToPlainText(conv, [
    { role: 'user', content: '안녕', createdAt: '2026-07-13T05:30:00Z' },
    { role: 'assistant', content: '반가워요', createdAt: '2026-07-13T05:30:05Z' },
  ])
  assert.ok(txt.startsWith('내 대화'))
  assert.ok(txt.includes('provider: claude'))
  assert.ok(txt.includes('[사용자]'))
  assert.ok(txt.includes('[어시스턴트]'))
  assert.ok(txt.includes('안녕'))
  assert.ok(txt.includes('반가워요'))
})

test('plain text: HTML 혼입 시 htmlToPlain으로 방어 변환(태그가 글자로 노출되지 않음)', () => {
  const txt = conversationToPlainText(conv, [
    { role: 'assistant', content: '첫줄<br/>둘째줄<p>문단</p>', createdAt: '2026-07-13T05:30:05Z' },
  ])
  assert.ok(!txt.includes('<br'))
  assert.ok(!txt.includes('<p>'))
  assert.ok(txt.includes('첫줄'))
  assert.ok(txt.includes('둘째줄'))
})

test('plain text: citations는 URL과 함께 목록으로 출력', () => {
  const txt = conversationToPlainText(conv, [
    {
      role: 'assistant',
      content: '답변',
      createdAt: '2026-07-13T05:30:05Z',
      citations: [{ url: 'https://a.com', title: 'A 사이트' }],
    },
  ])
  assert.ok(txt.includes('출처:'))
  assert.ok(txt.includes('A 사이트 (https://a.com)'))
})

// ── escapeHtml ──
test('escapeHtml: 마크업 특수문자 이스케이프', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(escapeHtml('A & B "C" \'D\''), 'A &amp; B &quot;C&quot; &#39;D&#39;')
})

// ── conversationToHtmlDocument (.pdf export 렌더 소스) ──
test('html document: 제목·메타·역할 섹션 포함, 원문 태그는 이스케이프됨', () => {
  const html = conversationToHtmlDocument(conv, [
    { role: 'user', content: '<b>강조</b>', createdAt: '2026-07-13T05:30:00Z' },
  ])
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('<h1>내 대화</h1>'))
  assert.ok(html.includes('provider: claude'))
  assert.ok(html.includes('msg-user'))
  // 사용자 원문의 <b> 태그가 실제 마크업으로 해석되지 않고 이스케이프되어야 함(주입 방지)
  assert.ok(html.includes('&lt;b&gt;강조&lt;/b&gt;'))
  assert.ok(!html.includes('<b>강조</b>'))
})

test('html document: citations는 링크 목록으로 출력', () => {
  const html = conversationToHtmlDocument(conv, [
    {
      role: 'assistant',
      content: '답변',
      createdAt: '2026-07-13T05:30:05Z',
      citations: [{ url: 'https://a.com', title: 'A 사이트' }],
    },
  ])
  assert.ok(html.includes('href="https://a.com"'))
  assert.ok(html.includes('A 사이트'))
})
