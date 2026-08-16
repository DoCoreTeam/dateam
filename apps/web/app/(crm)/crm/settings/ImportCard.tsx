'use client'

// 엑셀에서 들여오기 (dacrm FR-13, P0)
//
// **왜 필요한가**: 내보내기만 있으면 엑셀에서 CRM 으로 **이사를 못 한다.**
// 회사 목록이 엑셀에 있는 사람에게 "손으로 200개 넣으세요"라고 하면 그 사람은 CRM 을 안 쓴다.
//
// **넣기 전에 보여 준다.** 되돌리기를 만드는 대신 되돌릴 일을 안 만든다 —
// 몇 건이 새로 생기고 몇 건이 이미 있고 몇 건을 못 넣는지 먼저 세어 보여 준다.

import { useRef, useState } from 'react'
import { Upload, FileUp } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { IMPORT_LABEL, type ImportKind, type ImportPreview, type ImportOutcome } from '@/lib/crm/services/import-csv'
import styles from './settings.module.css'

const KINDS: ImportKind[] = ['companies', 'people']

export default function ImportCard() {
  const [kind, setKind] = useState<ImportKind>('companies')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null)
    setPreview(null)
    setOutcome(null)
    setFileName(f.name)
    try {
      setText(await f.text())
    } catch {
      setError('파일을 읽지 못했어요. CSV 로 저장한 뒤 다시 올려 주세요.')
    }
  }

  async function send(mode: 'preview' | 'apply') {
    if (!text.trim()) { setError('먼저 파일을 골라 주세요.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, text, mode }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '들여오지 못했습니다.'); return }
      setPreview(body.preview ?? null)
      setOutcome(body.outcome ?? null)
    } catch {
      setError('들여오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`card ${styles.card}`}>
      <h2 className={styles.cardTitle}>엑셀에서 들여오기</h2>
      <p className={styles.cardDesc}>
        엑셀을 CSV 로 저장해 올리면 회사·인물을 한 번에 만듭니다.
        첫 줄에 <strong>회사명·도메인</strong> 같은 칸 이름이 있으면 알아서 맞춰요.
        <strong> 넣기 전에 무엇이 생기는지 먼저 보여 드립니다.</strong>
      </p>

      <FormErrorBanner message={error} />

      <div className={styles.actions}>
        <label className="label">
          무엇을
          <select
            className="input-field"
            value={kind}
            onChange={(e) => { setKind(e.target.value as ImportKind); setPreview(null); setOutcome(null) }}
          >
            {KINDS.map((k) => <option key={k} value={k}>{IMPORT_LABEL[k]}</option>)}
          </select>
        </label>

        <NbButton variant="ghost" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} /> {fileName || 'CSV 고르기'}
        </NbButton>
        {/* 숨긴 입력이라 폼 표준(input-field)을 붙이지 않는다 — 보이지 않는 것에 모양은 뜻이 없다 */}
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={pick} />

        <NbButton onClick={() => void send('preview')} disabled={busy || !text}>
          {busy ? '보는 중…' : '먼저 보기'}
        </NbButton>

        {/* 미리보기를 본 뒤에만 넣을 수 있다 — 안 보고 넣으면 되돌릴 일이 생긴다 */}
        {preview && !outcome && preview.counts.create > 0 && (
          <NbButton onClick={() => void send('apply')} disabled={busy}>
            <Upload size={14} /> {preview.counts.create}건 넣기
          </NbButton>
        )}
      </div>

      {preview && (
        <div className={styles.undo}>
          <p>
            새로 만들 것 <strong>{preview.counts.create}건</strong> ·
            이미 있는 것 {preview.counts.exists}건 ·
            못 넣는 것 {preview.counts.skip}건
            {preview.truncated && ' (파일이 길어 앞부분만 봤어요)'}
          </p>

          {/* 못 알아본 칸을 숨기지 않는다 — 숨기면 사람은 데이터가 들어간 줄 안다 */}
          {preview.ignored.length > 0 && (
            <p>
              <NbBadge status="note">안 쓰는 칸</NbBadge>{' '}
              {preview.ignored.join(', ')} — 이 칸들은 들어가지 않아요
            </p>
          )}

          {preview.plans.filter((p) => p.verdict !== 'create').slice(0, 5).map((p) => (
            <p key={p.line}>{p.line}행 {p.name || '(이름 없음)'} — {p.reason}</p>
          ))}
        </div>
      )}

      {outcome && (
        <div className={styles.undo}>
          <p><strong>{outcome.created}건</strong>을 만들었어요. {outcome.skipped}건은 건너뛰었습니다.</p>
          {/* 실패를 조용히 삼키지 않는다 — 몇 행이 왜 안 됐는지 알아야 고친다 */}
          {outcome.failed.length > 0 && (
            <>
              <p>{outcome.failed.length}건은 넣지 못했어요:</p>
              {outcome.failed.slice(0, 5).map((f) => (
                <p key={f.line}>{f.line}행 {f.name} — {f.reason}</p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
