/**
 * 우리가 아는 사람 이름을 모아 주는 한 자리
 *
 * ## 왜 추측하지 않나
 *
 * 이름은 개인정보인데 자리표 규칙으로는 안 잡힌다. 정규식으로 이름을 찾으려 하면
 * 틀렸을 때 두 방향으로 다 나쁘다 — 놓친 이름은 그대로 나가고, 엉뚱하게 잡은 낱말은
 * 문장을 부순다. 둘 다 **출력을 사람이 읽을 때까지 안 보인다.**
 *
 * 그런데 추측할 필요가 없다. 이름은 이미 우리 것이다 —
 * 주소록 인물, 회의 참석자, 구성원 프로필. 가진 목록과 맞추는 것은 정확하다.
 *
 * ## 못 읽으면 빈 목록이다
 *
 * 이름을 못 읽었다고 AI 호출을 막지 않는다. 가림은 더 좋아지는 것이지 문을 닫는
 * 장치가 아니다. 목록이 비면 예전처럼 동작하고, 그것은 이 변경 전의 상태와 같다.
 */

/** 이 모듈이 쓰는 최소한. 테스트가 가짜를 끼울 수 있게 좁게 잡는다 */
export interface NameReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

/** 이름 같지 않은 값을 걸러 낸다. 빈 값과 너무 짧은 것은 가릴 수 없다 */
function usable(names: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const n of names) {
    const t = (n ?? '').trim()
    if (t.length >= 3) out.add(t)
  }
  return Array.from(out)
}

/**
 * 회의 하나의 참석자 이름.
 *
 * `meeting_notes.attendees` 는 사람이 적은 이름 배열이다. 그 회의의 녹음을 보낼 때
 * 그 안에 나올 이름이 바로 이것이다.
 */
export async function namesForNote(db: NameReader, noteId: string): Promise<string[]> {
  try {
    const { data } = await db.from('meeting_notes')
      .select('attendees').eq('id', noteId).maybeSingle()
    const raw = (data as { attendees?: unknown } | null)?.attendees
    return Array.isArray(raw) ? usable(raw as string[]) : []
  } catch {
    // 못 읽었다. 호출을 막지 않는다
    return []
  }
}

/**
 * 주소록에 있는 인물 이름.
 *
 * 리드나 딜 메모처럼 «누구» 가 나올 수 있는 글에 쓴다. 전부 읽으면 큰 조직에서
 * 목록이 길어지므로 상한을 둔다 — 상한을 넘으면 가림이 덜 되는 것이고, 그것은
 * 호출이 막히는 것보다 낫다.
 */
export const MAX_KNOWN_NAMES = 2000

export async function namesFromDirectory(db: NameReader): Promise<string[]> {
  try {
    const { data } = await db.from('crm_people')
      .select('name').is('deleted_at', null).limit(MAX_KNOWN_NAMES)
    const rows = (data as { name?: string }[] | null) ?? []
    return usable(rows.map((r) => r.name))
  } catch {
    return []
  }
}

/**
 * 우리 구성원 이름.
 *
 * 일일업무와 주간보고는 바깥 사람보다 **동료 이름**이 훨씬 자주 나온다 —
 * 「김 책임과 협의」 같은 줄이다. 주소록(crm_people)에는 그 이름이 없다.
 */
export async function namesFromProfiles(db: NameReader): Promise<string[]> {
  try {
    const { data } = await db.from('profiles')
      .select('name').limit(MAX_KNOWN_NAMES)
    const rows = (data as { name?: string }[] | null) ?? []
    return usable(rows.map((r) => r.name))
  } catch {
    return []
  }
}

/**
 * 서버가 이름 목록을 얻는 가장 짧은 길.
 *
 * 부르는 쪽이 관리자 클라이언트를 만들어 내려보내지 않아도 되게 한다 —
 * 그 수고가 곧 «이름은 다음에 붙이자» 가 된다.
 */
export async function serverKnownNames(): Promise<string[]> {
  const now = Date.now()
  if (cache && now - cache.at < NAME_CACHE_MS) return cache.names
  try {
    const { createAdminClient } = await import('../supabase/server.ts')
    const db = createAdminClient() as never as NameReader
    const [staff, people] = await Promise.all([
      namesFromProfiles(db), namesFromDirectory(db),
    ])
    const names = Array.from(new Set([...staff, ...people]))
    cache = { names, at: now }
    return names
  } catch {
    return []
  }
}

/**
 * 이름 목록을 잠깐 들고 있는다.
 *
 * AI 호출마다 표 둘을 읽으면 호출이 느려지고, 그러면 다음 사람이 «이름 가림은
 * 비싸다» 며 끈다. 조직 이름 목록은 **사람마다 다르지 않아서** 들고 있어도
 * 남의 것이 섞이지 않는다 — 사용자별 값이었다면 이렇게 두면 안 된다.
 */
const NAME_CACHE_MS = 5 * 60_000
let cache: { names: string[]; at: number } | null = null

/** 시험이 앞 회차의 목록을 물려받지 않게 한다 */
export function clearKnownNameCache(): void {
  cache = null
}
