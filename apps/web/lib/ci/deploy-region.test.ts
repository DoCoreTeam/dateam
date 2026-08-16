import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')

// 왜 이 가드가 있나 (v0.7.492 퍼포먼스 조사, docs/2026-08-16-performance-audit/PLAN.md §2-8):
//
//   Supabase는 서울(ap-northeast-2)에 있는데 `vercel.json`에 리전 지정이 **없었다**.
//   지정이 없으면 함수가 기본 리전(미 동부 iad1)에서 돌 수 있고, 그러면 DB 왕복 하나가
//   11~20ms에서 **약 190ms**로 늘어난다. 화면 하나가 왕복 20회를 쓰므로
//   **쿼리를 하나도 안 고쳐도 3.8초**가 된다.
//
//   설정 파일 한 줄이라 리팩터나 병합 과정에서 조용히 사라지기 쉽다 —
//   사라져도 화면은 멀쩡히 뜨고 그냥 느려지기만 하므로 아무도 못 알아챈다. 그래서 잠근다.

/** Supabase 프로젝트가 있는 곳. 함수는 여기와 같은 리전에서 돌아야 한다. */
const DB_REGION = 'ap-northeast-2'   // 서울
const FUNCTION_REGION = 'icn1'       // Vercel의 서울 코드

function vercelConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(web, 'vercel.json'), 'utf8'))
}

test('★ 함수 리전이 DB와 같은 서울로 고정돼 있다 — 다르면 왕복마다 태평양을 건넌다', () => {
  const cfg = vercelConfig()
  assert.deepEqual(cfg.regions, [FUNCTION_REGION],
    `리전 지정이 사라졌거나 바뀌었다. DB는 ${DB_REGION}(서울)에 있다`)
})

test('Supabase 주소가 여전히 서울 리전이다 — DB가 옮겨가면 함수도 따라가야 한다', () => {
  // .env.local은 커밋되지 않으므로 없으면 건너뛴다(CI에서 실패시키지 않는다)
  let env = ''
  try { env = readFileSync(join(web, '.env.local'), 'utf8') } catch { return }
  const m = env.match(/SUPABASE_(?:DB_)?URL=.*?(ap-northeast-2|us-east-\d|eu-\w+-\d)/)
  if (!m) return
  assert.equal(m[1], DB_REGION, `DB가 ${m[1]}로 옮겨갔다 — vercel.json의 regions도 함께 바꿔야 한다`)
})

test('★ 백스톱 크론이 매분이 아니다 — 브라우저 구동기가 주 경로고 크론은 보조다', () => {
  const cfg = vercelConfig()
  const crons = (cfg.crons ?? []) as { path: string; schedule: string }[]
  const drain = crons.find((c) => c.path.includes('analyze-drain'))
  assert.ok(drain, '백스톱 크론이 없어졌다 — 아무도 안 볼 때 큐가 멈춘다')
  assert.notEqual(drain.schedule, '* * * * *',
    '매분 크론은 하루 1,440회다. 사용자가 크론 비용을 줄이려 브라우저 구동 방식을 택했다')
})
