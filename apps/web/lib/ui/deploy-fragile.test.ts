// lib/ui/deploy-fragile.test.ts — 「코드는 맞는데 배포본만 깨지는」 자리를 막는 가드
//
// ## 왜 이 가드가 필요한가 (실측 2026-08-31)
//
// 주간보고 저장이 **2주 동안 프로덕션에서 100% 실패**했다. 원인은 코드가 아니라 배포본이었다.
// `next.config.js` 의 `serverComponentsExternalPackages` 에 `sanitize-html` 이 올라가 있어
// webpack 이 번들에 넣지 않았고, 배포본에는 그 파일이 안 실려 **모듈 로드 자체가 실패**했다.
//   · 프로덕션 저장 POST 500 ×7 (입력 무관, 인증 왕복 전 73~293ms 만에)
//   · 같은 코드가 로컬 프로덕션 빌드에서는 100% 성공
//   · 로컬에서 `sanitize-html` 만 못 찾게 막자 프로덕션과 **모든 지표가 일치**
//
// 그리고 그 실패가 **화면에도 로그에도 안 남았다** — 버튼이 영원히 「저장 중…」이었다.
//
// tsc·단위테스트·design:check 는 전부 초록이었다. **코드 검사로는 영원히 못 잡는다.**
// 그래서 "다시 그렇게 쓰지 못하게" 막는 것이 이 가드의 일이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './component-scan.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

/** 주어진 루트 아래 소스 파일을 전부 훑는다(주석 제거본과 함께). */
function scanApp(exts: readonly string[], roots: readonly string[] = ['app']): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) { walk(rel); continue }
      if (!exts.some((e) => name.endsWith(e))) continue
      out.push({ file: rel, src: stripComments(readFileSync(join(ROOT, rel), 'utf8')) })
    }
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * external 로 지정해도 되는 패키지 — **런타임에 바이너리·네이티브 파일을 푸는 것만**.
 * 순수 JS 는 번들하면 되고, 번들하면 배포본이 어긋날 자리 자체가 없어진다.
 */
const BINARY_BACKED = new Set(['puppeteer-core', '@sparticuz/chromium'])

test('① 번들 밖(external) 지정은 바이너리를 다루는 패키지만 — 순수 JS 를 올리지 않는다', () => {
  const cfg = read('next.config.js')
  const m = cfg.match(/serverComponentsExternalPackages:\s*\[([^\]]*)\]/)
  assert.ok(m, 'serverComponentsExternalPackages 선언을 찾지 못했습니다')

  const listed = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  const wrong = listed.filter((p) => !BINARY_BACKED.has(p))
  assert.deepEqual(
    wrong, [],
    `번들해도 되는 패키지가 external 로 지정돼 있습니다: ${wrong.join(', ')}\n` +
    '  → external 은 「번들하지 마라」일 뿐 「배포본에 넣어라」가 아닙니다.\n' +
    '  → 배포본에 안 실리면 그 코드 경로가 통째로 죽습니다(주간보고 2주 사망의 원인).\n' +
    '  → 순수 JS 면 목록에서 빼세요. 정말 필요하면 BINARY_BACKED 에 이유와 함께 추가하세요.',
  )
})

test('② external 로 남긴 패키지는 배포본 포함(outputFileTracingIncludes)이 함께 있어야 한다', () => {
  const cfg = read('next.config.js')
  const m = cfg.match(/serverComponentsExternalPackages:\s*\[([^\]]*)\]/)
  const listed = [...(m?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  if (listed.length === 0) return // 아무것도 external 이 아니면 포함 선언도 필요 없다

  assert.ok(
    /outputFileTracingIncludes\s*:/.test(cfg),
    'external 패키지가 있는데 outputFileTracingIncludes 선언이 없습니다.\n' +
    '  → 추적만 믿으면 pnpm 심링크 구조에서 누락될 수 있고, 그 누락은 런타임 500 으로만 드러납니다.',
  )
  for (const pkg of listed) {
    const needle = pkg.replace('/', '+') // '@sparticuz/chromium' → pnpm 디렉터리 표기
    assert.ok(
      cfg.includes(needle) || cfg.includes(pkg),
      `external 패키지 ${pkg} 가 outputFileTracingIncludes 에 없습니다 — 배포본에 안 실릴 수 있습니다.`,
    )
  }
})

/**
 * ③ **화면이 결과를 기다리는 서버 액션**은 redirect() 로 이탈하지 않는다.
 *
 * 왜: 서버 액션이 redirect 하면 Next 가 응답을 되돌려주지 못한다
 * (`failed to forward action response TypeError: fetch failed at httpRedirectFetch`).
 * 그 결과 `await action()` 이 **undefined** 를 돌려주고, 화면은 `result.ok` 를 읽다 터진다.
 * → `setPending(false)` 가 영영 실행되지 않아 버튼이 「저장 중…」에서 멈춘다.
 *
 * **`<form action={서버액션}>` 은 여기 해당하지 않는다** — 반환값을 읽는 코드가 없고
 * 이동 자체가 결과다(로그인·비밀번호 변경·KPI 등록이 그 형태다).
 * 그래서 가드는 파일이 아니라 **함수 단위**로, 그리고 **클라이언트가 부르는 것만** 본다.
 */
/**
 * ③ 의 예외 — **이동 자체가 결과**인 액션.
 *
 * 로그인은 성공했을 때 돌려줄 값이 없다. 진행 표시도 `useFormStatus` 가 액션 promise 에
 * 직접 매여 있어 우리가 `setPending(false)` 를 놓칠 자리가 없다 —
 * 주간보고를 2주간 세운 「멈춘 진행 표시」가 구조적으로 생기지 않는다.
 * 여기에 새 이름을 넣으려면 **「돌려줄 값이 정말 없는가」**를 먼저 답해야 한다.
 */
const NAVIGATION_IS_THE_RESULT = new Set(['signIn'])

test('③ 클라이언트가 결과를 기다리는 서버 액션은 redirect() 를 쓰지 않는다', () => {
  const files = scanApp(['.ts', '.tsx'])
  const clientSrc = files.filter((f) => /^\s*['"]use client['"]/.test(f.src)).map((f) => f.src).join('\n')

  const offenders: string[] = []
  for (const { file, src } of files) {
    if (!/^\s*['"]use server['"]/.test(src)) continue
    // 내보낸 async 함수를 하나씩 떼어 그 안에 redirect 가 있는지 본다
    const re = /export\s+async\s+function\s+(\w+)/g
    const marks: { name: string; at: number }[] = []
    for (let m = re.exec(src); m; m = re.exec(src)) marks.push({ name: m[1], at: m.index })
    for (let i = 0; i < marks.length; i++) {
      const body = src.slice(marks[i].at, marks[i + 1]?.at ?? src.length)
      if (!/\bredirect\(/.test(body)) continue
      // 클라이언트 컴포넌트가 이 함수를 import 해서 쓰면 반환값을 기다린다는 뜻이다
      if (NAVIGATION_IS_THE_RESULT.has(marks[i].name)) continue
      if (new RegExp(`\\b${marks[i].name}\\b`).test(clientSrc)) {
        offenders.push(`${file} — ${marks[i].name}()`)
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    '클라이언트가 결과를 기다리는 서버 액션이 redirect() 로 이탈합니다:\n' +
    offenders.map((o) => `  ${o}`).join('\n') +
    '\n  → 화면이 undefined 를 받아 진행 표시가 영원히 안 꺼집니다(주간보고 「저장 중…」).\n' +
    '  → { ok: false, error, reason } 처럼 **값으로** 돌려주고 이동은 화면이 하세요.',
  )
})

test('④ 라우트 그룹마다 오류 경계(error.tsx)가 있다', () => {
  // 왜: 없으면 화면 하나가 깨질 때 앱 전체가 최상위 오류 화면으로 떨어진다
  //     (실측: 화면 107개인데 error.tsx 는 1개뿐이었다).
  const GROUPS = ['app/(member)', 'app/admin', 'app/(crm)', 'app/(ci)', 'app/(auth)']
  const missing = GROUPS.filter((g) => existsSync(join(ROOT, g)) && !existsSync(join(ROOT, g, 'error.tsx')))
  assert.deepEqual(
    missing, [],
    `오류 경계가 없는 라우트 그룹: ${missing.join(', ')}\n` +
    '  → components/ui/RouteError 를 감싸는 error.tsx 를 두세요.',
  )
})

test('⑤ 주간보고 저장 화면은 실패를 반드시 끝낸다 — 시간 제한·try/catch·finally', () => {
  // 이 셋이 없어서 「저장 중…」이 2주 갔다. 하나라도 빠지면 같은 일이 다시 난다.
  // 주석을 걷어낸다 — 이 파일 주석에 `setPending(false)` 가 예시로 적혀 있어
  // 주석만 보고 통과하면 가드가 아무것도 안 지킨다(실측: 첫 판이 그랬다).
  const src = stripComments(read('app/(member)/weekly-report/WeeklyReportForm.tsx'))
  assert.ok(/SAVE_TIMEOUT_MS/.test(src), '저장에 시간 제한(SAVE_TIMEOUT_MS)이 없습니다')
  assert.ok(/Promise\.race\(/.test(src), '시간 제한이 실제로 걸려 있지 않습니다(Promise.race 없음)')
  assert.ok(/finally\s*\{\s*[\s\S]{0,80}?setPending\(false\)/.test(src), 'finally 에서 진행 표시를 되돌리지 않습니다')
  assert.ok(/catch\s*\(/.test(src), '제출 핸들러에 try/catch 가 없습니다')
})

test('⑥ 주간보고 저장 실패는 로그에 남는다 — 화면에도 로그에도 안 남던 자리다', () => {
  const src = read('app/(member)/weekly-report/actions.ts')
  assert.ok(/recordSystemEvent/.test(src), '저장 경로에 실패 계측(recordSystemEvent)이 없습니다')
  assert.ok(
    !/from ['"]next\/navigation['"]/.test(stripComments(src)),
    '저장 액션이 아직 next/navigation(redirect)을 씁니다 — 화면이 결과를 못 읽습니다',
  )
})

/**
 * ⑦ **사용자를 막는 제출은 무방비로 두지 않는다** (ratchet — 늘면 차단).
 *
 * 진행 표시를 켜 놓고 `try/finally` 도 시간 제한도 없으면, 본문이 던지는 순간
 * 끄는 줄에 **도달하지 못한다** — 버튼이 영원히 「저장 중…」이 된다.
 * 주간보고가 그랬고, 전수 조사 결과 같은 모양이 화면 20곳에 있었다.
 * 17곳을 `lib/forms/submit-guard` 한 벌로 이관했고, 나머지는 아래에 이유와 함께 적는다.
 */
const SUBMIT_GUARD_PENDING = new Set([
  // 다른 세션이 지금 쓰고 있어 건드리지 않았다(M-9 ④) — 그 세션이 끝나면 이관 대상이다
  'app/(member)/daily/page.tsx',
  'app/(member)/lead-intake/IntakeActions.tsx',
  // 제출이 아니다 — 라우트 이동 로더다(타이머를 cleanup 에서 정리한다)
  'components/ui/NavigationLoader.tsx',
])

test('⑦ 진행 표시를 켜는 화면은 반드시 끝을 보장한다 (ratchet)', () => {
  const unguarded: string[] = []
  for (const { file, src } of scanApp(['.tsx'], ['app', 'components'])) {
    if (!/set(Pending|Loading|Saving|Submitting)\(true\)/.test(src)) continue
    if (/\bfinally\b|withSubmitGuard/.test(src)) continue
    unguarded.push(file)
  }
  const extra = unguarded.filter((f) => !SUBMIT_GUARD_PENDING.has(f))
  assert.deepEqual(
    extra, [],
    '진행 표시를 켜 놓고 끝을 보장하지 않는 화면이 늘었습니다:\n' +
    extra.map((f) => `  ${f}`).join('\n') +
    '\n  → lib/forms/submit-guard 의 withSubmitGuard 로 감싸세요(시간 제한·try/catch·finally 한 벌).',
  )
  const gone = [...SUBMIT_GUARD_PENDING].filter((f) => !unguarded.includes(f))
  assert.deepEqual(
    gone, [],
    `이관이 끝난 항목이 예외 목록에 남아 있습니다: ${gone.join(', ')}\n` +
    '  → SUBMIT_GUARD_PENDING 에서 지워 되돌아가지 못하게 잠그세요.',
  )
})

/**
 * ⑧ **오류 화면은 일어나지 않는 일을 말하지 않는다.**
 *
 * 실측 2026-08-31: 오류 화면이 「방금 무슨 일이 있었는지 관리자에게 자동으로 전달했어요」라고 했다.
 * 실제로 하는 일은 `system_events` 에 한 줄 남기는 것뿐이고 **누구에게도 알림이 가지 않는다.**
 * 관리자 본인이 그 화면을 보고 물었다 — "나에게 오는 알림은 없는데? 내가 관리자인데".
 *
 * 화면이 사실 아닌 말을 하면 사용자는 오지 않을 것을 기다리고,
 * 그 뒤로는 **사실인 말까지 같이 못 믿는다.** 그래서 문구를 코드로 잠근다.
 */
const NOTIFY_CLAIMS = [
  '관리자에게 자동으로 전달',
  '관리자에게 전달했',
  '알림을 보냈',
  '메일을 보냈',
]

test('⑧ 오류 화면이 「알림을 보냈다」고 말하지 않는다 — 알림 보내는 코드가 없다', () => {
  const bad: string[] = []
  for (const { file, src } of scanApp(['.tsx'], ['app', 'components'])) {
    if (!/error\.tsx$|RouteError\.tsx$/.test(file)) continue
    // 주석은 뺀다 — 왜 그렇게 썼었는지 설명하는 줄까지 잡으면 기록을 못 남긴다
    const rendered = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const c of NOTIFY_CLAIMS) if (rendered.includes(c)) bad.push(`${file} — 「${c}…」`)
  }
  assert.deepEqual(
    bad, [],
    '오류 화면이 일어나지 않는 일을 말합니다:\n' + bad.map((x) => `  ${x}`).join('\n') +
    '\n  → 실제로 하는 일은 system_events 에 기록하는 것뿐입니다. 알림을 보내려면 먼저 보내는 코드를 만드세요.',
  )
})

test('⑧-2 기록에 실패했으면 「남겼다」고 말하지 않는다', () => {
  const src = read('components/ui/RouteError.tsx')
  assert.match(src, /setLogged/, '기록 결과를 안 보고 문구를 정한다 — 실패해도 성공처럼 말하게 된다')
  assert.match(src, /logged === false/, '실패했을 때의 다른 문구가 없다')
})
