/**
 * RFP 네 층이 말할 수 있는 상태로 남아 있는지 본다
 *
 * **왜 둘인가**
 *
 * ① 걸 수 있는데 안 도는 단계: 교차검증은 이름도 우선순위도 화면 버튼도 있었는데
 *    실행기가 없었다. 누르면 잡이 걸리고 **202 가 돌아오고**, 그 잡은 반드시 실패했다.
 *    화면은 걸렸다고 말하고 결과는 안 온다 — 실패보다 나쁜 것은 걸린 척이다.
 *
 * ② 특정 업체에 유리하다는 단정: 그것은 사실 주장이고, 틀리면 근거 없이 남을 비난한 것이
 *    된다. 우리가 볼 수 있는 것은 조항의 모양뿐이라 「경쟁 제한 의심」까지만 말한다.
 *    말은 한 번 코드에 들어가면 화면과 내보내기와 제안서로 번진다.
 *
 * 검사 셋:
 *   1) 도는 단계는 전부 걸 수 있고, 걸 수 있는데 안 도는 단계는 문 앞에서 막힌다
 *   2) 특정 업체에 유리하다는 말이 코드에 없다
 *   3) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOB_TYPES, RUNNABLE_JOB_TYPES, isRunnable } from '../rfp/jobs/stages.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RFP_ROOTS = ['lib/rfp', 'app/api/rfp', 'app/(rfp)', 'components/rfp']

function rfpSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts')) continue
      out.push({ rel: relative(WEB, full), src: readFileSync(full, 'utf8') })
    }
  }
  for (const r of RFP_ROOTS) walk(join(WEB, r))
  return out
}

test('★ 걸 수 있는데 안 도는 단계는 문 앞에서 막힌다', () => {
  const notRunnable = JOB_TYPES.filter((t) => !isRunnable(t))
  // 안 붙은 단계가 하나도 없으면 이 검사는 볼 것이 없다. 그때는 그렇게 말한다
  if (notRunnable.length === 0) {
    assert.equal(RUNNABLE_JOB_TYPES.length, JOB_TYPES.length)
    return
  }

  const offenders: string[] = []
  for (const stage of notRunnable) {
    // 이 단계를 큐에 넣는 코드는 넣기 전에 isRunnable 을 물어야 한다
    for (const f of rfpSources()) {
      if (!f.src.includes(`jobType: '${stage}'`)) continue
      // import 줄만 있고 안 부르는 것을 통과시키면 안 된다. 실제 호출을 센다
      const asks = f.src.split('\n')
        .filter((l) => !l.trim().startsWith('import'))
        .some((l) => l.includes('isRunnable('))
      if (!asks) {
        offenders.push(`${f.rel} 이 ${stage} 를 거는데 돌 수 있는지 안 묻는다`)
      }
    }
  }
  assert.deepEqual(offenders, [], [
    '실행기가 없는 단계를 그냥 건다. 사용자는 걸렸다는 답을 받고 결과는 영영 안 온다:',
    ...offenders.map((o) => `  ${o}`),
    '고치는 법: 걸기 전에 isRunnable 로 묻고, 아니면 걸지 않는다',
  ].join('\n'))
})

/** 주석을 걷어낸다. 규칙을 적어 둔 주석까지 잡으면 규칙을 적는 것이 위반이 된다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 그 줄이 「그렇게 쓰지 않는다」고 말하고 있나 */
function isProhibition(line: string): boolean {
  return /않는다|않음|안 만든다|안 쓴다|금지|말 것|하지 마/.test(line)
}

test('★ 특정 업체에 유리하다는 단정을 안 만든다', () => {
  // 조항의 모양만 보고 누구에게 유리한지는 못 본다. 못 보는 것을 말하지 않는다.
  //
  // 처음엔 파일 전체를 훑어 **금지 문구를 적어 둔 주석 셋**을 잡았다.
  // 규칙을 적는 것이 위반이 되면 아무도 규칙을 안 적는다. 그래서 주석을 걷어내고,
  // 남은 줄 중 「않는다」처럼 부정이 붙은 줄도 뺀다 — 그것은 단정이 아니라 금지다.
  const banned = [/특정\s*업체에?\s*유리/, /특정\s*업체\s*밀어주기/, /favors?[_\s]specific[_\s]vendor/i]
  const offenders: string[] = []
  for (const f of rfpSources()) {
    for (const line of stripComments(f.src).split('\n')) {
      if (isProhibition(line)) continue
      for (const re of banned) {
        if (re.test(line)) offenders.push(`${f.rel} 에 「${line.trim().slice(0, 50)}」`)
      }
    }
  }
  assert.deepEqual(offenders, [], [
    '특정 업체에 유리하다는 단정이 코드에 있다. 그것은 사실 주장이고 틀리면 근거 없이 남을 비난한 것이 된다.',
    '「경쟁 제한 의심」까지만 말한다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 깨져 0개가 되면 위 검사는 «위반 없음»으로 통과해 버린다
  const files = rfpSources()
  assert.ok(files.length >= 50, `RFP 소스를 ${files.length}개만 찾았다`)
  assert.ok(JOB_TYPES.length >= 4)
  assert.ok(RUNNABLE_JOB_TYPES.length >= 1)
})
