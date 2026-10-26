/**
 * 기기에 적는 회의 기록, 오프라인 녹음 중에 쓰는 자리 (SSOT)
 *
 * 왜 생겼나: 「녹음 시작」은 회의를 시작하는 일이라 녹음하면서 기록을 적을 수 있어야 한다.
 * 연결이 있으면 작업대가 열려 그 자리에 적는다. 연결이 없으면 회의가 기기에서 먼저 만들어지고
 * (`local-meeting`) 화면을 옮기지 않으므로 **적을 자리가 없었다.**
 * 그래서 녹음 바가 그 자리를 열고, 적은 글은 여기에 둔다. 연결이 돌아오면 회의노트 본문으로 올라간다.
 *
 * 저장은 `localStorage` 뿐이다. 서버 창구가 없다.
 * 개인정보 규율은 `local-meeting` 과 같다: 올라간 글은 지우고, 못 올라간 것도 `MAX_KEEP_DAYS` 까지만 둔다.
 */

import { MAX_KEEP_DAYS } from './blob-store.ts'

export const LOCAL_MEMO_PREFIX = 'newax.local-memo.'

const DAY_MS = 86_400_000

interface StoredMemo {
  text: string
  savedAt: number
}

function pick(store?: Storage): Storage | null {
  if (store) return store
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function keyOf(localId: string): string {
  return `${LOCAL_MEMO_PREFIX}${localId}`
}

function readRaw(localId: string, s: Storage): StoredMemo | null {
  try {
    const raw = s.getItem(keyOf(localId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredMemo> | null
    if (!parsed || typeof parsed.text !== 'string' || typeof parsed.savedAt !== 'number') return null
    return { text: parsed.text, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

function isExpired(m: StoredMemo, now: number): boolean {
  return now - m.savedAt > MAX_KEEP_DAYS * DAY_MS
}

/** 적은 글을 기기에 둔다. 못 두면 **false**, 된 줄 알고 넘어가면 그 글을 잃는다 */
export function saveLocalMemo(
  localId: string, text: string, store?: Storage, now: number = Date.now(),
): boolean {
  const s = pick(store)
  if (!s || !localId) return false
  try {
    s.setItem(keyOf(localId), JSON.stringify({ text, savedAt: now } satisfies StoredMemo))
    return true
  } catch {
    return false
  }
}

/** 기한 안의 글. 없거나 기한이 지났으면 빈 글 */
export function readLocalMemo(localId: string, store?: Storage, now: number = Date.now()): string {
  const s = pick(store)
  if (!s || !localId) return ''
  const m = readRaw(localId, s)
  if (!m || isExpired(m, now)) return ''
  return m.text
}

export function removeLocalMemo(localId: string, store?: Storage): void {
  const s = pick(store)
  if (!s || !localId) return
  try {
    s.removeItem(keyOf(localId))
  } catch {
    // 지우지 못해도 기한이 지나면 읽히지 않는다
  }
}

function allIds(s: Storage): string[] {
  const ids: string[] = []
  try {
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i)
      if (k && k.startsWith(LOCAL_MEMO_PREFIX)) ids.push(k.slice(LOCAL_MEMO_PREFIX.length))
    }
  } catch {
    return []
  }
  return ids
}

/** 기한 안의 글이 있는 지역 id */
export function listLocalMemoIds(store?: Storage, now: number = Date.now()): string[] {
  const s = pick(store)
  if (!s) return []
  return allIds(s).filter((id) => {
    const m = readRaw(id, s)
    return !!m && !isExpired(m, now)
  })
}

/** 기한 지난 글을 지운다 */
export function pruneLocalMemos(store?: Storage, now: number = Date.now()): void {
  const s = pick(store)
  if (!s) return
  for (const id of allIds(s)) {
    const m = readRaw(id, s)
    if (!m || isExpired(m, now)) removeLocalMemo(id, s)
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 적은 글을 회의노트 본문 HTML 로 바꾼다.
 *
 * 줄마다 `<p>` 하나. 사이의 빈 줄은 `<p></p>` 로 남겨 사람이 띄운 간격을 지킨다.
 * 앞뒤 빈 줄은 버리고, 글이 없으면 빈 문자열을 준다(빈 본문을 올리지 않게).
 */
export function memoTextToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines
    .slice(start, end)
    .map((line) => (line.trim() === '' ? '<p></p>' : `<p>${escapeHtml(line)}</p>`))
    .join('')
}
