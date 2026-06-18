// 커밋 → 버전별 체인지로그 그룹 파서 (SSOT, 순수함수).
// 빌드 스크립트(gen-changelog-source)와 단위테스트가 공유. 커밋 형식: `vX.Y.Z: 내용 claude`.
import type { ChangeType, ChangeItem, Release, RawCommit } from './types'

const VERSION_RE = /^v(\d+\.\d+\.\d+):\s*(.+)$/

/** 변경 문구에서 타입 추론(배지색). 키워드 우선순위: fix > improve > feature(기본). */
export function classifyType(text: string): ChangeType {
  const t = text.toLowerCase()
  if (/(픽스|버그|수정|fix|hotfix|오류|에러|결함)/.test(t)) return 'fix'
  if (/(개선|리팩터|리팩토링|정리|최적화|refactor|improve|tweak|보정)/.test(t)) return 'improve'
  return 'feature'
}

/** 커밋 제목 정제: 버전 접두사·꼬리표(claude)·트레일러 제거 → 변경 문구만. 비대상이면 null. */
export function cleanSubject(subject: string): { version: string; text: string } | null {
  const m = subject.trim().match(VERSION_RE)
  if (!m) return null // merge/revert/형식밖 → 스킵
  const version = m[1]
  let text = m[2].trim()
  // 끝의 소문자 'claude' 꼬리표 제거(커밋 규칙)
  text = text.replace(/\s+claude\s*$/i, '').trim()
  // 혹시 본문 트레일러가 한 줄에 섞였으면 제거
  text = text.replace(/\s*Co-Authored-By:.*$/i, '').trim()
  if (!text) return null
  return { version, text }
}

/**
 * git log(최신순) → 버전별 그룹. 동일 버전의 여러 커밋은 changes[]로 묶음.
 * released_at = 그 버전 커밋 중 가장 최신 날짜. 그룹 type = 첫(최신) 변경의 type.
 */
export function parseCommits(commits: RawCommit[]): Release[] {
  const order: string[] = []
  const map = new Map<string, Release>()

  for (const c of commits) {
    const parsed = cleanSubject(c.subject)
    if (!parsed) continue
    const { version, text } = parsed
    const item: ChangeItem = { text, type: classifyType(text) }

    let rel = map.get(version)
    if (!rel) {
      rel = { version, released_at: c.date || null, title: text, changes: [], type: item.type }
      map.set(version, rel)
      order.push(version)
    } else if (c.date && (!rel.released_at || c.date > rel.released_at)) {
      rel.released_at = c.date
    }
    rel.changes.push(item)
  }

  // git log가 최신순이므로 order 그대로(최신 버전 위). title은 첫 변경 유지.
  return order.map((v) => map.get(v) as Release)
}
