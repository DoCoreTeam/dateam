import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAnalyzeSource, isAnalyzable, streamUrlFor } from './analyzable.ts'

const BASE = {
  assetId: 'a1', workspaceId: 'ws1', sourceKind: 'link' as const,
  driveFileId: null, sourceUrl: null, mime: null, platform: null,
}

test('드라이브에 원본이 있으면 우리 경로로 읽는다 — 화면·소리 전부 가능', () => {
  const out = resolveAnalyzeSource({ ...BASE, driveFileId: 'drive123', sourceUrl: 'https://drive.google.com/file/d/drive123/view' })
  assert.equal(out.mode, 'stream')
  assert.equal(out.mode === 'stream' && out.url, streamUrlFor('a1', 'ws1'))
})

test('올려서 드라이브에 보관 중인 파일도 같은 경로다', () => {
  const out = resolveAnalyzeSource({ ...BASE, sourceKind: 'file', driveFileId: 'd9', mime: 'video/mp4' })
  assert.equal(out.mode, 'stream')
})

test('유튜브 링크는 원본을 못 읽는다 — 겉정보만', () => {
  const out = resolveAnalyzeSource({
    ...BASE, sourceUrl: 'https://www.youtube.com/watch?v=abc', platform: 'youtube',
  })
  assert.equal(out.mode, 'meta')
})

test('직접 mp4 주소는 시도한다 — 상대가 허용하면 된다', () => {
  const out = resolveAnalyzeSource({ ...BASE, sourceUrl: 'https://cdn.example.com/a/clip.mp4' })
  assert.equal(out.mode, 'direct')
})

test('브라우저가 못 여는 컨테이너는 미리 막고 이유를 말한다', () => {
  const out = resolveAnalyzeSource({ ...BASE, sourceUrl: 'https://cdn.example.com/a/clip.mkv' })
  assert.equal(out.mode, 'none')
  assert.match(out.mode === 'none' ? out.reason : '', /MKV/)
})

test('예전 Supabase 저장분은 읽을 경로가 없다 — 그렇다고 말한다', () => {
  const out = resolveAnalyzeSource({ ...BASE, sourceKind: 'file', mime: 'video/mp4' })
  assert.equal(out.mode, 'none')
  assert.equal(isAnalyzable({ ...BASE, sourceKind: 'file', mime: 'video/mp4' }), false)
})

test('영상이 아닌 자료는 분석 대상이 아니다', () => {
  const out = resolveAnalyzeSource({ ...BASE, sourceKind: 'file', mime: 'application/pdf' })
  assert.equal(out.mode, 'none')
})

test('일반 웹페이지 링크는 원본이 없다', () => {
  const out = resolveAnalyzeSource({ ...BASE, sourceUrl: 'https://example.com/blog/post' })
  assert.equal(out.mode, 'none')
})
