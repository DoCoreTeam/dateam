import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filePath, irPath, orgOfPath, putBytes, getBytes, putJson, getJson, RFP_BUCKET } from './storage.ts'

const ORG = '11111111-1111-1111-1111-111111111111'
const CASE = '22222222-2222-2222-2222-222222222222'
const FILE = '33333333-3333-3333-3333-333333333333'

test('같은 파일이면 같은 경로 — 올리기가 멱등이다', () => {
  assert.equal(filePath(ORG, CASE, 'abc'), filePath(ORG, CASE, 'abc'))
  assert.notEqual(filePath(ORG, CASE, 'abc'), filePath(ORG, CASE, 'abd'))
})

test('경로 1단계는 조직 — 정책이 이 자리를 본다', () => {
  assert.equal(orgOfPath(filePath(ORG, CASE, 'abc')), ORG)
  assert.equal(orgOfPath(irPath(ORG, CASE, FILE, 2)), ORG)
})

test('IR 은 판마다 다른 자리 — 다시 파싱해도 앞 판을 안 덮는다', () => {
  assert.notEqual(irPath(ORG, CASE, FILE, 1), irPath(ORG, CASE, FILE, 2))
})

/** supabase-js 는 오류를 던지지 않고 돌려준다 — 그 모양을 그대로 흉내 낸다 */
function fakeStorage(behavior: 'ok' | 'fail', body = '') {
  const calls: { op: string; path: string; opts?: Record<string, unknown> }[] = []
  const err = behavior === 'fail' ? { message: '권한 없음' } : null
  return {
    calls,
    client: {
      storage: {
        from(bucket: string) {
          assert.equal(bucket, RFP_BUCKET)
          return {
            async upload(path: string, _b: unknown, opts?: Record<string, unknown>) {
              calls.push({ op: 'upload', path, opts })
              return { data: err ? null : { path }, error: err }
            },
            async download(path: string) {
              calls.push({ op: 'download', path })
              return { data: err ? null : new Blob([body]), error: err }
            },
            async remove(paths: string[]) {
              calls.push({ op: 'remove', path: paths[0] })
              return { data: null, error: err }
            },
          }
        },
      },
    },
  }
}

test('올리기 실패는 던진다 — 조용히 지나가면 0바이트가 성공으로 보인다', async () => {
  const f = fakeStorage('fail')
  await assert.rejects(
    () => putBytes(f.client, 'p', new Uint8Array([1])),
    /원문을 저장하지 못했다/,
  )
})

test('덮어쓰기로 올린다 — 경로가 해시라 내용이 같다', async () => {
  const f = fakeStorage('ok')
  await putBytes(f.client, 'p', new Uint8Array([1]), 'application/pdf')
  assert.equal(f.calls[0].opts?.upsert, true)
  assert.equal(f.calls[0].opts?.contentType, 'application/pdf')
})

test('mime 이 비면 octet-stream 으로 올린다 — 한글 파일이 빈 mime 으로 온다', async () => {
  const f = fakeStorage('ok')
  await putBytes(f.client, 'p', new Uint8Array([1]), '')
  assert.equal(f.calls[0].opts?.contentType, 'application/octet-stream')
})

test('읽기 실패는 던진다 — null 을 돌려주면 빈 문서로 이어 간다', async () => {
  const f = fakeStorage('fail')
  await assert.rejects(() => getBytes(f.client, 'p'), /원문을 읽지 못했다/)
  await assert.rejects(() => getJson(f.client, 'p'), /파싱 결과를 읽지 못했다/)
})

test('JSON 왕복', async () => {
  const f = fakeStorage('ok', JSON.stringify({ a: 1 }))
  await putJson(f.client, 'p', { a: 1 })
  assert.equal(f.calls[0].opts?.contentType, 'application/json')
  assert.deepEqual(await getJson<{ a: number }>(f.client, 'p'), { a: 1 })
})
