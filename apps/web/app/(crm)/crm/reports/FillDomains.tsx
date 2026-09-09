'use client'

/**
 * 회사 도메인 규칙 채우기 — **AI 를 부르지 않는다.**
 *
 * 「기관 종류」 축이 비어 보이는 이유는 회사에 도메인이 없어서고, 도메인은
 * 그 회사 사람의 이메일에서 규칙으로 나온다. 모델이 필요 없는 사실이다.
 * 이걸 AI 에 맡겼다가 보강 37건이 전부 할당량 초과로 죽은 적이 있다.
 *
 * **먼저 몇 곳인지 보여주고** 사람이 누를 때만 채운다. 데이터를 바꾸는 일이라 그렇다.
 */

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { failedTo } from '@/lib/terms'
import s from './metrics.module.css'

/** 더 채울 것이 없을 때의 말 — 화면이 문구를 직접 짓지 않는다(§0-2) */
const FILL_NONE = '이메일로 채울 수 있는 곳이 더는 없습니다'

interface Counts { fillable: number; unsure: number; noSignal: number }

export default function FillDomains({ onFilled }: { onFilled: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function look() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/crm/companies/fill-domains')
      const j = await r.json().catch(() => null)
      if (!r.ok) { setErr(j?.error?.message ?? failedTo('회사 정보', '보지')); return }
      setCounts(j as Counts)
    } catch { setErr(failedTo('회사 정보', '보지')) } finally { setBusy(false) }
  }

  async function fill() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/crm/companies/fill-domains', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setErr(j?.error?.message ?? failedTo('회사 도메인', '채우지')); return }
      const failed = (j?.failed ?? []) as unknown[]
      // 실패를 성공처럼 말하지 않는다
      setDone(failed.length > 0
        ? `${j.filled}곳 채웠고 ${failed.length}곳은 못 했어요`
        : `${j.filled}곳 채웠어요`)
      setCounts(null)
      onFilled()
    } catch { setErr(failedTo('회사 도메인', '채우지')) } finally { setBusy(false) }
  }

  if (done) return <span className={s.fillDone}>{done}</span>
  if (err) return <span className={s.err}>{err}</span>

  return (
    <span className={s.fill}>
      {busy && <AXDotLoader />}
      {!busy && !counts && (
        <button type="button" className={s.linkBtn} onClick={() => void look()}>
          이메일로 채울 수 있는지 보기
        </button>
      )}
      {!busy && counts && (
        counts.fillable > 0 ? (
          <>
            <span>이메일 도메인으로 {counts.fillable}곳을 바로 채울 수 있어요 (AI 안 씀)</span>
            <NbButton variant="ghost" onClick={() => void fill()}>채우기</NbButton>
          </>
        ) : (
          <span>
            {FILL_NONE}
            {counts.unsure > 0 && ` · 메일이 여러 회사로 갈려 사람이 봐야 하는 곳 ${counts.unsure}곳`}
          </span>
        )
      )}
    </span>
  )
}
