'use client'

// CRM 안에서 찾기 (dacrm)
//
// **왜 이 화면이 생겼나**: 셸의 검색창은 `/work/search`(호스트 업무 검색)로 간다.
// CRM 안에서 "삼성"을 치면 CRM 을 떠나 엉뚱한 결과가 나왔고,
// 정작 삼성SDS 회사·딜은 어디에도 없었다.
//
// **한 종류만 찾지 않는다.** "삼성"이 회사인지 딜인지 인물인지는 찾는 사람도 모른다.
// 그래서 네 가지를 함께 보여 주고 종류를 밝힌다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Building2, Users, Handshake, Mic } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { isEnterKey } from '@/lib/ui/ime'
import { KIND_LABEL, type SearchKind } from '@/lib/crm/services/search'
import styles from './search.module.css'

interface Hit { kind: SearchKind; id: string; title: string; sub: string | null; href: string }

const ICON: Record<SearchKind, React.ReactNode> = {
  company: <Building2 size={14} />,
  person: <Users size={14} />,
  deal: <Handshake size={14} />,
  meeting: <Mic size={14} />,
}

const ORDER: SearchKind[] = ['company', 'person', 'deal', 'meeting']

export default function SearchClient({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initialQuery)
  const [hits, setHits] = useState<Hit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState('')

  const run = useCallback(async (query: string) => {
    const term = query.trim()
    if (term.length < 2) {
      setHits([])
      setSearched(term)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/search?q=${encodeURIComponent(term)}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '찾지 못했습니다.'); return }
      setHits(body.hits ?? [])
      setTruncated(!!body.truncated)
      setSearched(term)
    } catch {
      setError('찾지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  // 주소의 검색어로 먼저 찾는다 — 링크를 받은 사람도 같은 결과를 본다
  useEffect(() => { void run(initialQuery) }, [initialQuery, run])

  function submit() {
    const term = q.trim()
    // 주소를 바꾼다 — 뒤로 가기가 이전 검색으로 돌아가고, 링크로 공유된다
    router.push(term ? `/crm/search?q=${encodeURIComponent(term)}` : '/crm/search')
    void run(term)
  }

  const byKind = ORDER
    .map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) }))
    .filter((g) => g.items.length > 0)

  return (
    <>
      <div className={styles.bar}>
        <input
          className="input-field"
          value={q}
          autoFocus
          placeholder="회사·사람·딜·미팅 이름으로 찾기 (두 글자 이상)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) submit() }}
          aria-label="찾을 말"
        />
        <NbButton onClick={submit} disabled={loading}>
          <Search size={16} /> {loading ? '찾는 중…' : '찾기'}
        </NbButton>
      </div>

      {error && <ErrorState message={error} onRetry={() => void run(q)} />}

      {!error && loading && hits.length === 0 && <AXDotLoader />}

      {!error && !loading && searched.length > 0 && searched.length < 2 && (
        <p className={styles.hint}>두 글자 이상 넣어 주세요. 한 글자로는 거의 전부가 걸려요.</p>
      )}

      {!error && !loading && searched.length >= 2 && hits.length === 0 && (
        <EmptyState
          title={`"${searched}"로 찾은 게 없어요`}
          description="이름 일부만 넣어도 됩니다. 회사는 도메인으로도, 사람은 이메일로도 찾을 수 있어요."
          icon={<Search size={28} />}
        />
      )}

      {byKind.map((g) => (
        <section key={g.kind} className={styles.group}>
          <h2 className={styles.groupTitle}>
            {ICON[g.kind]} {KIND_LABEL[g.kind]} {g.items.length}건
          </h2>
          <ul className={styles.list}>
            {g.items.map((h) => (
              <li key={`${h.kind}:${h.id}`} className={styles.item}>
                <Link href={h.href} className={styles.link}>
                  <span className={styles.title}>{h.title}</span>
                  {h.sub && <span className={styles.sub}>{h.sub}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 잘렸으면 잘렸다고 말한다 — 조용히 자르면 "이게 전부"로 읽힌다 */}
      {truncated && (
        <p className={styles.hint}>
          <NbBadge status="note">더 있음</NbBadge> 결과가 많아 종류별로 몇 개만 보여 드렸어요.
          더 좁혀서 찾아 보세요.
        </p>
      )}
    </>
  )
}
