/**
 * 벤더 직접 호출 기준선, 관문을 안 지나는 길이 더 늘지 않게 한다
 *
 * **왜**: AI 를 부를 때 지켜야 할 것(시간 제한, 개인정보 가림, 폴백, 비용, 전송 기록)은
 * 관문 하나에 모여 있다. 그런데 벤더 주소를 코드에 직접 적고 fetch 하는 파일이
 * **스물아홉 개** 있고, 그 길로 나가는 호출에는 그 다섯이 하나도 안 붙는다.
 * 전송 원장이 비어 있던 진짜 이유가 이것이다. 기록이 고장난 것이 아니라
 * 대부분의 호출이 문을 안 지난다.
 *
 * 스물아홉을 지금 당장 막지는 않는다. 막으면 멀쩡히 도는 기능이 멈춘다.
 * 대신 **기준선**을 둔다. 늘면 실패하고, 관문으로 옮겨 줄면 기준선을 따라 내린다.
 * 이 저장소가 기존 위반을 다루는 방식이 그것이다.
 *
 * 패키지는 안 훑는다. `packages/ai-providers` 가 벤더 주소를 들고 있지만 그것은
 * **등록부**지 호출이 아니다. 주소를 아는 것과 그 주소로 나가는 것은 다른 일이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE = JSON.parse(
  readFileSync(join(WEB, 'lib/policy/vendor-call-baseline.json'), 'utf8'),
) as { 훑는곳: string[]; 패턴: string; 파일: string[]; 관문안쪽?: Record<string, string> }

function scan(): string[] {
  const re = new RegExp(BASELINE.패턴)
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
      if (re.test(readFileSync(full, 'utf8'))) hits.push(relative(WEB, full))
    }
  }
  for (const root of BASELINE.훑는곳) walk(join(WEB, root))
  return hits.sort()
}

test('★ 관문을 안 지나는 파일이 기준선보다 늘지 않았다', () => {
  const known = new Set(BASELINE.파일)
  const added = scan().filter((f) => !known.has(f))
  assert.deepEqual(added, [], [
    '벤더 주소를 직접 들고 fetch 하는 파일이 늘었다.',
    '이 길로 나가는 호출에는 시간 제한도 개인정보 가림도 폴백도 비용도 전송 기록도 안 붙는다.',
    '@ax/ai-gateway 의 callWithFallback 을 쓰거나, 정말 예외라면 기준선에 사유와 함께 더한다:',
    ...added.map((f) => `  ${f}`),
  ].join('\n'))
})

test('★ 관문으로 옮겨 사라진 파일은 기준선에서도 지운다', () => {
  const now = new Set(scan())
  const gone = BASELINE.파일.filter((f) => !now.has(f))
  assert.deepEqual(gone, [], [
    '기준선에 있는데 실제로는 없다. 관문으로 옮겼거나 파일이 지워졌다는 뜻이다.',
    'lib/policy/vendor-call-baseline.json 의 「파일」 에서 아래를 지운다.',
    '기준선을 안 내리면 그 자리만큼 다시 늘어도 가드가 못 잡는다:',
    ...gone.map((f) => `  ${f}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  /*
    패턴이나 경로가 깨져 0개가 되면 위 검사는 «늘지 않았다»로 통과해 버린다.

    처음에는 «스무 개 이상 나와야 한다» 로 잡았는데, 그러면 **줄이는 일 자체가**
    이 검사를 깨뜨린다. 세는 것이 아니라 **아는 것 하나를 실제로 잡는가**를 본다.
  */
  const found = new Set(scan())
  assert.ok(BASELINE.파일.length > 0, '기준선 목록이 비었다')
  const missed = BASELINE.파일.filter((f) => !found.has(f))
  assert.deepEqual(missed, [], `기준선에 적힌 파일을 스캐너가 못 잡는다: ${missed.join(', ')}`)
})

test('★ 사유 없이 벤더 주소를 들고 있는 파일이 없다', () => {
  /*
    처음에 이 기준선은 «스물아홉이 있고 늘지만 마라» 였다. 그것으로는
    "왜 아직 밖에 있나"를 아무도 안 물었고, 그래서 스물다섯이 넉 달 남았다.

    이제 전부 관문을 지난다. 남은 것은 **주소를 들고 있을 이유가 있는** 파일뿐이고,
    그 이유는 「관문안쪽」에 한 줄씩 적혀 있다. 이유 없이 목록에 들어오면 실패한다 —
    그것이 «나중에 옮기자» 가 다시 쌓이는 자리다.
  */
  const reasons = BASELINE.관문안쪽 as Record<string, string> | undefined
  assert.ok(reasons, '관문안쪽 설명이 없다')
  const unexplained = BASELINE.파일.filter((f) => !(reasons![f] ?? '').trim())
  assert.deepEqual(unexplained, [], [
    '벤더 주소를 들고 있는데 왜 그래야 하는지가 안 적혀 있다.',
    '관문으로 옮기거나, 못 옮기는 이유를 「관문안쪽」에 한 줄 적는다:',
    ...unexplained.map((f) => `  ${f}`),
  ].join('\n'))
})

test('★ 사유가 가리키는 파일이 실제로 있다', () => {
  // 파일이 지워지거나 이름이 바뀌면 사유만 남아 «설명된 것»으로 계속 통과한다
  const reasons = (BASELINE.관문안쪽 ?? {}) as Record<string, string>
  const known = new Set(BASELINE.파일)
  const orphan = Object.keys(reasons).filter((f) => !known.has(f))
  assert.deepEqual(orphan, [], `목록에 없는 파일의 사유가 남아 있다: ${orphan.join(', ')}`)
})
