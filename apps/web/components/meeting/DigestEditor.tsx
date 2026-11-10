'use client'

/**
 * 정리본을 **그 자리에서** 고친다 — AI 를 부르지 않는다.
 *
 * 사용자 지시(2026-10-21): *"한글자만 고치면 되는데 AI를 쓰는게 오히려 손해잖아"*.
 *
 * 줄마다 글 칸 하나. 보내는 것은 **바뀐 칸의 자리와 글뿐**이다 — 근거와 출처는 서버가 기준 판에서
 * 그대로 가져간다(`lib/meeting/digest-edit.ts`). 줄을 비우면 그 줄이 빠진다.
 */

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import { ACTION, progress } from '@/lib/terms'
import type { DigestResult } from '@/lib/meeting/digest'
import type { DigestEdit, DigestEditPath } from '@/lib/meeting/digest-edit'
import { digestDraftKey, serializeDigestDraft, type DigestDraft } from '@/lib/meeting/digest-draft'
import styles from './digest.module.css'

interface Props {
  noteId: string
  baseSeq: number
  digest: DigestResult
  onSaved: (seq: number, changed: number) => void
  onCancel: () => void
  /** 임시 저장 키를 가를 사용자. 모르면 남기지 않는다 */
  userId: string | null
  /** 새로고침 전에 고치던 것. 있으면 그때 본 판 위에서 이어 고친다 */
  restored?: DigestDraft | null
}

const keyOf = (p: DigestEditPath): string => JSON.stringify(p)

export default function DigestEditor({ noteId, baseSeq: currentSeq, digest: currentDigest, onSaved, onCancel, userId, restored }: Props) {
  // 되살린 것은 그때 본 판 기준이다 — 자리 번호가 그 판을 가리킨다
  const [baseSeq] = useState(restored?.baseSeq ?? currentSeq)
  const [digest] = useState(restored?.digest ?? currentDigest)
  const [drafts, setDrafts] = useState<Map<string, DigestEdit>>(
    () => new Map((restored?.edits ?? []).map((e) => [keyOf(e.path), e])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storageKey = userId ? digestDraftKey(userId, noteId) : null

  // 고칠 때마다 브라우저에 남긴다 — 저장이 막히거나 새로고침해도 고친 글이 사라지지 않게
  useEffect(() => {
    if (!storageKey || drafts.size === 0) return
    try {
      localStorage.setItem(storageKey, serializeDigestDraft({ baseSeq, digest, edits: [...drafts.values()] }, Date.now()))
    } catch { /* 저장소를 못 쓰는 브라우저면 화면 상태로만 둔다 */ }
  }, [storageKey, baseSeq, digest, drafts])

  const clearStored = () => {
    if (!storageKey) return
    try { localStorage.removeItem(storageKey) } catch { /* 위와 같다 */ }
  }
  const cancel = () => { clearStored(); onCancel() }

  const valueOf = (path: DigestEditPath, original: string): string => drafts.get(keyOf(path))?.text ?? original
  const change = (path: DigestEditPath, text: string) =>
    setDrafts((prev) => new Map(prev).set(keyOf(path), { path, text }))

  async function save() {
    if (saving) return
    if (drafts.size === 0) { cancel(); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/digest`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseSeq, edits: [...drafts.values()] }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body?.error ?? '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); return }
      clearStored()
      onSaved(Number(body.seq), Number(body.changed ?? 0))
    } catch {
      setError('저장하지 못했어요. 연결을 확인해 주세요. 고친 내용은 이 화면에 그대로 있어요.')
    } finally {
      setSaving(false)
    }
  }

  const field = (path: DigestEditPath, original: string, label: string, rows = 1, strong = false) => (
    <textarea
      className={`input-field ${styles.editField}${strong ? ` ${styles.editFieldStrong}` : ''}${drafts.has(keyOf(path)) ? ` ${styles.editFieldChanged}` : ''}`}
      rows={rows}
      value={valueOf(path, original)}
      onChange={(e) => change(path, e.target.value)}
      aria-label={label}
    />
  )

  return (
    <div className={styles.editor}>
      <p className={styles.editHint}>고칠 곳을 눌러 바로 고치세요. 줄을 비우면 그 줄이 빠지고, 고친 것은 「이전 정리」에 남아 언제든 돌아갈 수 있어요.</p>
      {restored && <p className={styles.editHint}>저장하지 않고 나갔던 고친 내용을 다시 불러왔어요.</p>}
      {error && <InlineError spaced onDismiss={() => setError(null)}>{error}</InlineError>}

      {(digest.outcome || digest.nextStep) && (
        <section className={styles.agenda}>
          <h3 className={styles.agendaTitle}>이 회의는</h3>
          {field({ kind: 'outcome' }, digest.outcome, '이 회의는')}
          {field({ kind: 'nextStep' }, digest.nextStep, '다음에 할 일')}
        </section>
      )}

      {digest.agenda.map((a, i) => (
        <section key={i} className={styles.agenda}>
          {field({ kind: 'agendaTitle', agenda: i }, a.title, `안건 ${i + 1} 제목`, 1, true)}
          {a.facts.map((f, j) => (
            <div key={j}>{field({ kind: 'fact', agenda: i, fact: j }, f.text, `${a.title} ${j + 1}번째 줄`)}</div>
          ))}
        </section>
      ))}

      {digest.decisions.length > 0 && (
        <section className={styles.agenda}>
          <h3 className={styles.agendaTitle}>결정사항</h3>
          {digest.decisions.map((d, i) => (
            <div key={i}>{field({ kind: 'decision', index: i }, d.text, `결정사항 ${i + 1}`)}</div>
          ))}
        </section>
      )}

      <div className={styles.editActions}>
        <NbButton variant="ghost" onClick={cancel} disabled={saving}>{ACTION.cancel}</NbButton>
        <NbButton onClick={() => void save()} disabled={saving}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Save size={14} aria-hidden /> {saving ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </div>
  )
}
