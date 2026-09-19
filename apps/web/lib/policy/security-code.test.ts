/**
 * 코드에서 새는 자리를 막는다
 *
 * **왜**: 2026-09-20 보안 점검은 데이터베이스에서 시작했지만, 같은 모양의 구멍이
 *   코드에도 있다. 공통점은 하나다. **틀려도 화면이 멀쩡하다.**
 *   sanitize 를 빠뜨려도 정상 글은 잘 보이고, 바깥 주소를 그대로 부르는 코드도
 *   평소에는 잘 돈다. 그래서 사람 눈이 아니라 여기서 센다.
 *
 * 검사 셋:
 *   1) HTML 을 직접 꽂는 자리는 sanitize 를 거치거나 escape 후에 조립한다
 *   2) 코드에 비밀 모양 문자열을 박지 않는다
 *   3) 서버가 변수 주소로 나가는 fetch 는 **늘어나지 않는다** (SSRF)
 *      지금 있는 것은 기준선으로 얼려 두고, 새로 만들면 lib/security/safe-fetch 를 쓴다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, match, out)
    else if (match.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(WEB, f).split('\\').join('/')

test('HTML 을 직접 꽂는 자리는 정화를 거친다', () => {
  const files = [
    ...walk(join(WEB, 'app'), /\.tsx?$/),
    ...walk(join(WEB, 'components'), /\.tsx?$/),
    ...walk(join(WEB, 'lib'), /\.tsx?$/),
  ]
  const raw: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!src.includes('dangerouslySetInnerHTML')) continue
    // sanitize 를 거쳤거나, escape 를 먼저 하고 조립했으면 통과
    if (/sanitize|DOMPurify|escapeHtml/i.test(src)) continue
    raw.push(`  ${rel(f)}`)
  }
  assert.deepEqual(
    raw,
    [],
    `정화 없이 HTML 을 꽂는 파일 ${raw.length}개\n${raw.join('\n')}\n\n` +
      `sanitizeRichHtml 을 거치거나, escapeHtml 로 먼저 막고 조립한다.\n` +
      `AI 응답도 「우리 것」이 아니다. 프롬프트에 남이 넣은 값이 섞인다.`,
  )
})

test('코드에 비밀 모양 문자열을 박지 않는다', () => {
  const files = [
    ...walk(join(WEB, 'app'), /\.tsx?$/),
    ...walk(join(WEB, 'lib'), /\.tsx?$/),
    ...walk(join(WEB, 'components'), /\.tsx?$/),
  ]
  // 실제로 본 적 있는 모양만 센다. 넓게 잡으면 오탐이 나고, 오탐이 나면 가드가 꺼진다.
  const SECRET = /(sk-[A-Za-z0-9]{24,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/
  const hits: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    src.split('\n').forEach((line, i) => {
      if (SECRET.test(line)) hits.push(`  ${rel(f)}:${i + 1}`)
    })
  }
  assert.deepEqual(
    hits,
    [],
    `비밀 모양 문자열 ${hits.length}건\n${hits.join('\n')}\n\n` +
      `환경변수나 DB 에 두고 읽는다. 이미 커밋됐으면 그 값은 **폐기하고 새로 발급**한다.`,
  )
})

/**
 * 서버가 변수 주소로 나가는 fetch 목록.
 *
 * 이 목록은 **줄어들 수는 있어도 늘어나면 안 된다.** 새 항목은 SSRF 통로가 될 수 있다
 * (DB 에 심은 주소를 서버가 그대로 부르면 사설망이나 메타데이터 주소를 물릴 수 있다).
 * 새로 만들 때는 lib/security/safe-fetch 의 safeFetchText 를 쓰고 여기에는 안 적는다.
 */
const VARIABLE_URL_FETCH = new Set<string>([
  'lib/gemini-embedding.ts',
  'lib/swr-config.ts',
  'lib/ui/use-bulk-action.ts',
  'lib/ci/connectors/youtube-uploads.ts',
  'lib/ci/connectors/channel-feed.ts',
  'lib/ci/connectors/meta-tags.ts',
  'lib/ci/connectors/youtube-channel.ts',
  'lib/ci/connectors/weather.ts',
  'lib/ci/connectors/youtube.ts',
  'lib/ci/production/video-analyze.ts',
  'lib/ci/ai/creative-server.ts',
  'lib/ci/media/understand-server.ts',
  'lib/crm/api/paper-image.ts',
  'lib/crm/api/download.ts',
  'lib/ai-chat/providers/gemini.ts',
  'lib/ai/gemini-call.ts',
])

const VAR_FETCH = /await fetch\((url|targetUrl|pageUrl|link|href|endpoint|src|u)[,)]/

test('변수 주소로 나가는 fetch 가 늘어나지 않는다', () => {
  const files = [...walk(join(WEB, 'lib'), /\.tsx?$/), ...walk(join(WEB, 'app', 'api'), /\.ts$/)]
  const found = new Set<string>()
  for (const f of files) {
    const r = rel(f)
    // 개발자센터의 예제 코드는 **글자**다. 문자열 안에 fetch 가 있을 뿐 아무것도 부르지 않는다.
    if (r.startsWith('lib/api-docs/')) continue
    if (VAR_FETCH.test(readFileSync(f, 'utf8'))) found.add(r)
  }

  const added = [...found].filter((f) => !VARIABLE_URL_FETCH.has(f)).sort()
  assert.deepEqual(
    added,
    [],
    `변수 주소로 나가는 fetch 가 늘었다 (${added.length}건)\n${added.map((x) => '  ' + x).join('\n')}\n\n` +
      `주소를 우리가 정하지 않으면 사설망이나 클라우드 메타데이터(169.254.169.254)를 물릴 수 있다.\n` +
      `lib/security/safe-fetch 의 safeFetchText 를 쓴다. 벤더 주소를 상수로 조립하는 경우에만\n` +
      `이 목록에 추가하되, 왜 안전한지 주석으로 남긴다.`,
  )

  // 고친 것은 목록에서 빼라고 알려 준다. 안 그러면 목록이 영원히 안 줄어든다.
  const gone = [...VARIABLE_URL_FETCH].filter((f) => !found.has(f)).sort()
  assert.deepEqual(
    gone,
    [],
    `목록에 있는데 코드에 없다 (${gone.length}건)\n${gone.map((x) => '  ' + x).join('\n')}\n` +
      `고쳤거나 지웠으면 VARIABLE_URL_FETCH 에서도 뺀다.`,
  )
})
