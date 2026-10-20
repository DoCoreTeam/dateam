'use client'

// 특기사항을 견적서 화면에서 바로 고친다 (P0145)
//
// **왜 수정 창 말고 여기인가**: 특기사항은 견적서를 읽다가 고치는 글이다. 수정 창은 항목과 금액을
// 고치는 자리라 특기사항이 맨 아래 접힌 칸에 있었고, 거기까지 가려면 문서를 떠나야 했다
// (사용자 지시 2026-10-20: 「기타사항 쪽에 에디터 넣어서 할 수 있게」).
//
// 저장은 기존 수정 창구(PATCH /api/crm/quotes/[id])를 그대로 쓴다 — 버전 잠금과 권한 확인,
// 서버 정리기가 같이 따라온다. 새 창구를 열지 않는다.

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import RichText from '@/components/ui/RichText'
import { ACTION, progress, failedTo } from '@/lib/terms'
import { QUOTE } from '@/lib/terms/quote'
import { readApiError } from '@/lib/crm/api/read-error'
import styles from './quote-note-editor.module.css'

// 편집기는 누를 때만 받는다 — 견적서를 읽기만 하는 사람에게 편집기 묶음을 싣지 않는다
const TiptapEditor = dynamic(() => import('@/components/ui/TiptapEditor'), { ssr: false })

interface Props {
  quoteId: string
  /** 낙관적 잠금 판 번호. 다른 사람이 먼저 고쳤으면 서버가 충돌로 막는다 */
  version: number | null
  /** 서버가 걸러 준 그릴 HTML. 없으면 비었다 */
  html: string | null
  /** 견적서 본문의 절 제목과 글 서식 — 같은 모양이어야 고친 것이 종이에서 어떻게 보일지 안다 */
  classes: { title: string; body: string }
  onSaved: () => void
}

export default function QuoteNoteEditor({ quoteId, version, html, classes, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open() {
    setDraft(html ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    const fail = failedTo(QUOTE.customerNote, '저장하지')
    if (version === null) { setError(fail); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, notesMd: draft }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(readApiError(body, fail)); return }
      setEditing(false)
      onSaved()
    } catch {
      setError(fail)
    } finally {
      setSaving(false)
    }
  }

  const head = (
    <div className={styles.head}>
      <p className={classes.title}>{QUOTE.customerNote}</p>
      {!editing && (
        <NbButton variant="ghost" className={styles.editBtn} onClick={open} aria-label={QUOTE.customerNoteEditLabel}>
          <Pencil size={14} /> {ACTION.edit}
        </NbButton>
      )}
    </div>
  )

  if (!editing) {
    return (
      <>
        {head}
        {html
          ? <RichText html={html} className={classes.body} />
          : <p className={styles.empty}>{QUOTE.customerNoteEmpty}</p>}
      </>
    )
  }

  return (
    <div className={styles.editor}>
      {head}
      <TiptapEditor
        value={draft}
        onChange={setDraft}
        placeholder={QUOTE.customerNotePlaceholder}
        minHeight={160}
        documentTools
      />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <NbButton variant="ghost" onClick={() => setEditing(false)} disabled={saving}>{ACTION.cancel}</NbButton>
        <NbButton onClick={() => void save()} disabled={saving}>
          {saving ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </div>
  )
}
