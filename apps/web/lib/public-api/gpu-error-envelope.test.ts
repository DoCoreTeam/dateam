/**
 * GPU 공개 창구 여섯의 오류 봉투 가드
 *
 * 왜: 같은 창구 묶음 안에서 어떤 것은 respond.ts 로 한국어 봉투를 주고 어떤 것은
 *   NextResponse.json 으로 「Internal server error」 같은 영어를 직접 조립했다.
 *   깨진 JSON 본문은 catch 로 떨어져 500 으로 답했다. 보낸 쪽 잘못이 서버 고장처럼 읽혔다.
 *   오류는 respond.ts(fail, notFound, serverError) 한 곳에서만 만들고, 본문은 readJsonBody 로 읽는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const V1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'api', 'public', 'v1')

const ROUTES = [
  'products/route.ts',
  'products/[id]/route.ts',
  'quote/route.ts',
  'suppliers/route.ts',
  'settings/route.ts',
  'pool-stock/route.ts',
] as const

/** 주석을 지운 원문, 주석에 남은 옛 문구가 단정을 흐리지 않게 */
function codeOf(rel: string): string {
  return readFileSync(join(V1, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** `NextResponse.json(` 호출의 인자를 괄호 균형으로 잘라 돌려준다 */
function nextJsonCalls(src: string): string[] {
  const out: string[] = []
  const marker = 'NextResponse.json('
  let from = 0
  for (;;) {
    const at = src.indexOf(marker, from)
    if (at < 0) return out
    let depth = 1
    let i = at + marker.length
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') depth -= 1
      i += 1
    }
    out.push(src.slice(at + marker.length, i - 1))
    from = i
  }
}

/** 문자열 리터럴만 모은다 ('', "", ``) */
function stringLiterals(src: string): string[] {
  return [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0])
}

const ENGLISH_ERROR = /not found|validation error|internal server error|unauthorized|is required|invalid json|must be/i

test('대상 여섯 파일이 실재한다 (경로가 틀려 빈 원문으로 초록이 되지 않게)', () => {
  for (const rel of ROUTES) assert.ok(codeOf(rel).includes('export async function'), rel)
})

test('respond.ts 밖에서 오류 응답을 조립하지 않는다', () => {
  const bad: string[] = []
  for (const rel of ROUTES) {
    for (const args of nextJsonCalls(codeOf(rel))) {
      if (/\berror\s*:/.test(args) || /success\s*:\s*false/.test(args) || /status\s*:\s*[45]\d\d/.test(args)) {
        bad.push(`${rel}: NextResponse.json(${args.replace(/\s+/g, ' ').slice(0, 80)})`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('영어 오류 문자열이 없다', () => {
  const bad: string[] = []
  for (const rel of ROUTES) {
    for (const lit of stringLiterals(codeOf(rel))) {
      if (ENGLISH_ERROR.test(lit)) bad.push(`${rel}: ${lit}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('본문은 readJsonBody 로만 읽는다', () => {
  const bad: string[] = []
  for (const rel of ROUTES) {
    const src = codeOf(rel)
    if (/\brequest\.json\s*\(/.test(src)) bad.push(`${rel}: request.json() 직접 호출`)
    if (/\b(POST|PATCH|PUT)\b\s*\(/.test(src) && /export async function (POST|PATCH|PUT)/.test(src)) {
      if (!src.includes('readJsonBody(request)')) bad.push(`${rel}: 쓰기 창구인데 readJsonBody 없음`)
      if (!src.includes('INVALID_JSON_MESSAGE')) bad.push(`${rel}: 깨진 JSON 400 문구 없음`)
    }
  }
  assert.deepEqual(bad, [])
})

test('zod 원문을 응답에 싣지 않는다', () => {
  const bad: string[] = []
  for (const rel of ROUTES) {
    const src = codeOf(rel)
    if (/\.error\.(issues|errors|flatten|format)\b(?!\s*\))/.test(src.replace(/invalidInputMessage\([^)]*\)/g, ''))) {
      bad.push(`${rel}: zod 오류 원문 사용`)
    }
  }
  assert.deepEqual(bad, [])
})
