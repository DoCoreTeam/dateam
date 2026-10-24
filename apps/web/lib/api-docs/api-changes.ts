// lib/api-docs/api-changes.ts - 개발자센터 「API 변경 내역」의 원본
//
// 업데이트 내역(lib/changelog/entries.ts)에서 developer: true 인 줄만 골라 낸다.
// 목록을 따로 손으로 쓰지 않는다. 두 벌이 되면 한쪽이 늙는다.
// 태그를 빠뜨리면 api-changes.test.ts 가 빨갛게 된다.

import { CHANGELOG, type ChangelogNote, type ChangelogNoteItem } from '../changelog/entries.ts'

export interface ApiChange {
  version: string
  date: string
  title?: string
  items: ChangelogNoteItem[]
}

/** 버전 문자열을 숫자 배열로 (0.11.68 -> [0, 11, 68]) */
function versionParts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function compareVersionDesc(a: string, b: string): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** developer: true 인 줄만 남긴 업데이트를 최신 순으로. limit 를 주면 그 수만큼 */
export function selectApiChanges(
  notes: readonly ChangelogNote[] = CHANGELOG,
  limit?: number,
): ApiChange[] {
  const picked = notes
    .map((note) => ({
      version: note.version,
      date: note.date,
      title: note.title,
      items: note.items.filter((item) => item.developer === true),
    }))
    .filter((note) => note.items.length > 0)
    .sort((a, b) => compareVersionDesc(a.version, b.version))
  return typeof limit === 'number' && limit >= 0 ? picked.slice(0, limit) : picked
}
