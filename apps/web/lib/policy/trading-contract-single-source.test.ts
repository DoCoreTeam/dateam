import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 「지금 무엇을 거래하는가」의 답이 하나인지 **기계가 센다**
 *
 * 같은 질문에 답이 둘이어서 두 번 사고가 났다.
 *
 * - 2026-09-30: 검증 크론은 설정 덮어쓰기만 보고, 수집과 화면은 월물 표를 봤다.
 *   덮어쓰기가 빈 문자열이라 검증은 매번 `no_contract` 로 끝났고 `trading_job_runs` 에
 *   그 일이 **한 줄도 없었다**.
 * - 2026-10-02: 수집은 거래일마다 쓸 월물을 `trading_day_config` 에 굳히는데
 *   화면·실시간 가격·검증은 그것을 모르고 `trading_contracts.is_front` 를 봤다.
 *   교체 판정이 한 번 어긋나자 **크론은 A05611, 화면은 A05610** 을 보게 됐고,
 *   크론이 모은 봉을 화면이 못 찾아 그날 확정 봉이 0건이었다.
 *
 * 두 번 다 「고치면 끝」이 아니었다. 읽는 자리가 늘어날 때마다 같은 구멍이 다시 열린다.
 * 그래서 규칙을 문서가 아니라 이 파일이 묻는다.
 *
 * **이름을 세지 않고 질의를 센다.** 주석에 `is_front` 라고 적은 것은 위반이 아니고,
 * 표에 그 칼럼으로 묻는 것이 위반이다 — 이름만 찾는 가드는 주석을 지우면 통과한다.
 */

const CWD = process.cwd()
const read = (p: string) => readFileSync(join(CWD, p), 'utf8')

/** 고르는 규칙과 그 규칙에 넣을 값을 읽는 자리. 여기 안에서는 표를 직접 물어도 된다 */
const SSOT_DIR = 'lib/trading/contracts/'

/** 훑을 소스 — `.ts`·`.tsx` 전부. 목록을 손으로 들면 새로 생긴 자리를 애초에 못 본다 */
function sources(roots: readonly string[]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(join(CWD, dir))) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const rel = `${dir}/${e}`
      if (statSync(join(CWD, rel)).isDirectory()) walk(rel)
      else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(rel)
    }
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * 주석을 떼고 본다. **주석도 통과시키는 가드는 가드가 아니다** —
 * 반대로 주석에 적은 설명을 위반으로 세면 설명을 못 적게 만든다.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** 표에 `is_front` 칼럼으로 묻는 자리. 이름이 아니라 질의를 센다 */
const ASKS_IS_FRONT = /\.eq\(\s*['"]is_front['"]|select\(\s*['"][^'"]*\bis_front\b/

describe('월물 단일 출처 — 「지금 무엇을 거래하는가」의 답은 하나다', () => {
  it('★ is_front 를 직접 묻는 운영 코드가 contracts/ 밖에 0곳이다', () => {
    const files = sources(['app', 'lib'])
    assert.ok(files.length > 500, `훑은 파일이 ${files.length}개뿐이다 — 규칙이 헛돈다`)

    const offenders = files.filter((f) => {
      if (f.startsWith(SSOT_DIR)) return false
      if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) return false
      return ASKS_IS_FRONT.test(code(read(f)))
    })
    assert.deepEqual(
      offenders, [],
      `월물 표를 직접 묻는 자리가 ${SSOT_DIR} 밖에 있다:\n  ${offenders.join('\n  ')}\n\n` +
        '수집이 그날 굳힌 값(trading_day_config)을 모르는 자리가 되어, 교체가 한 번 어긋나면\n' +
        '크론이 모은 봉을 그 화면이 못 찾는다(실측 2026-10-02 확정 봉 0건).\n' +
        'lib/trading/contracts/today-contract.ts 의 loadTodayContract(Code|Head) 를 쓴다.',
    )
  })

  it('★ 그 표를 묻는 자리가 SSOT 안에 살아 있다 — 0곳이면 월물 표로 떨어질 길이 끊긴 것이다', () => {
    const inside = sources([SSOT_DIR.replace(/\/$/, '')])
      .filter((f) => !f.endsWith('.test.ts') && ASKS_IS_FRONT.test(code(read(f))))
    assert.ok(
      inside.length > 0,
      `${SSOT_DIR} 안에서 is_front 를 묻는 자리가 0곳이다 — 그날 첫 수집 전에 볼 답이 없어진다`,
    )
  })

  it('★ 고르는 규칙을 우회하지 않는다 — pickFrontContract 를 부르는 자리도 contracts/ 안뿐이다', () => {
    const files = sources(['app', 'lib'])
    const outside = files.filter((f) => {
      if (f.startsWith(SSOT_DIR)) return false
      if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) return false
      return /pickFrontContract\s*\(/.test(code(read(f)))
    })
    assert.deepEqual(
      outside, [],
      `고르는 규칙을 밖에서 직접 부른다:\n  ${outside.join('\n  ')}\n\n` +
        '규칙만 부르고 값 읽기를 각자 하면 굳은 값을 빼먹은 호출이 다시 생긴다.\n' +
        'loadTodayContract(Code|Head) 가 셋을 함께 읽어 규칙에 넣는다.',
    )
  })

  it('★ 읽는 자리가 셋 이상 그 하나를 부른다 — 하나라도 표로 돌아가면 위 규칙이 잡는다', () => {
    const files = sources(['app', 'lib'])
    const callers = files.filter((f) => {
      if (f.startsWith(SSOT_DIR)) return false
      if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) return false
      return /loadTodayContract(Code|Head)?\s*\(/.test(code(read(f)))
    })
    assert.ok(
      callers.length >= 3,
      `부르는 자리가 ${callers.length}곳이다(${callers.join(', ')}) — 2026-10-03 기준 셋이다: ` +
        '현황(lib/trading/overview.ts) · 실시간 가격(lib/trading/bars/live-price.ts) · ' +
        '검증(app/api/trading/cron/validate/route.ts)',
    )
  })

  /*
    **스크립트는 운영 코드가 아니지만 같은 월물을 봐야 한다.**

    `scripts/` 는 사람이 손으로 한 번 돌리는 자리라 표를 직접 물어도 된다 —
    굳은 값을 **바로잡는** 도구는 표가 근거여야 하므로 금지하면 그 도구를 못 만든다.
    다만 굳은 값을 아예 안 보면 수집이 모으는 것과 다른 월물을 만지게 된다
    (받아 온 봉이 엉뚱한 월물에 쌓이면 그 봉은 아무도 안 본다).

    그래서 금지가 아니라 **둘을 같이 보라**로 묻는다.
  */
  it('★ 표를 직접 묻는 스크립트는 그날 굳은 값도 함께 본다', () => {
    const files = sources(['scripts']).concat(
      readdirSync(join(CWD, 'scripts'))
        .filter((e) => e.endsWith('.mjs'))
        .map((e) => `scripts/${e}`),
    )
    const blind = files.filter((f) => {
      const src = code(read(f))
      return ASKS_IS_FRONT.test(src) && !/trading_day_config/.test(src)
    })
    assert.deepEqual(
      blind, [],
      `월물 표만 보고 그날 굳은 값을 안 보는 스크립트가 있다:\n  ${blind.join('\n  ')}\n\n` +
        '수집이 굳힌 월물과 다른 것을 만지게 된다 — 받아 온 봉이 아무도 안 보는 자리에 쌓인다.',
    )
  })
})

describe('월물 교체 — 거래가 끝난 날의 거래량으로 정한다', () => {
  const ROLL = 'lib/trading/contracts/roll.ts'
  const TICK = 'lib/trading/jobs/tick.ts'

  it('★ 교체 판정이 당일 누적 거래량을 안 본다', () => {
    /*
      묻는 때가 자정이라 그 시각 두 월물의 당일 누적은 둘 다 0 근처다. 그것을 견주면
      한 계약 차이로 월물이 바뀐다 — 판정이 아니라 동전 던지기다(실측 2026-10-02:
      그날 거래량 84,206 인 10월물을 두고 957 인 11월물로 갈아탔다).
    */
    for (const f of [ROLL, TICK]) {
      assert.doesNotMatch(
        code(read(f)), /acml_vol/,
        `${f} 가 당일 누적 거래량(acml_vol)을 쓴다 — 자정에 묻는 값이라 0 대 0 이다. ` +
          '마지막으로 끝난 거래일의 하루 거래량(dailyBars)을 쓴다',
      )
    }
  })

  it('★ 수집이 넘기는 거래량이 일봉에서 온다', () => {
    const src = code(read(TICK))
    assert.match(src, /lastSessionVolumeOf\s*:/, '교체 판정에 거래량을 안 넘긴다')
    assert.match(
      src, /lastSessionVolumeOf\s*:[\s\S]{0,600}?dailyBars\s*\(/,
      'lastSessionVolumeOf 가 dailyBars 를 안 부른다 — 고정값이나 현재가를 넘기면 판정이 거짓말한다',
    )
  })

  it('★ 거래량을 못 읽으면 안 갈아탄다, 기한은 그래도 걸린다', () => {
    const src = code(read(ROLL))
    assert.match(src, /unknown_volume/, '못 읽은 것을 사유로 남기지 않는다')
    assert.match(src, /deadline_reached/, '기한이 거래량과 무관하게 걸리는 길이 없다')
  })
})
