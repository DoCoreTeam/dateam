'use client'

// 내보내기 미리보기 — 결과를 먼저 보고 형식을 고른다.
//
// 왜 iframe인가: 미리보기는 "받게 될 문서"여야 한다. 앱 CSS가 스며들면 화면과 산출물이 어긋나고,
// 그 어긋남은 파일을 열어봐야만 발견된다. 서버가 실제 산출과 같은 빌더로 만든 HTML을
// 격리된 iframe(srcDoc·sandbox)에 그대로 띄워, 본 것과 받는 것을 같게 만든다.
import { useCallback, useEffect, useState } from 'react'
import { EXPORT_VIEW_LABEL, type MeetingExportView } from '@/lib/meeting/export-html'
import { copyExportDocument } from '@/lib/meeting/export-clipboard'
import { Check, ClipboardCopy, FileDown, ImageIcon } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import styles from './meeting-export.module.css'

interface Props {
  meetingNoteId: string
  /** 현재 보고 있는 탭 — 미리보기와 산출물이 같은 뷰를 쓴다. */
  /** 담을 것. 값 집합은 빌더가 정한다(SSOT) — 여기서 다시 나열하면 뷰가 늘 때 한쪽만 고쳐진다 */
  view: MeetingExportView
  onClose: () => void
}

export default function MeetingExportModal({ meetingNoteId, view, onClose }: Props) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState<null | 'pdf' | 'png'>(null)
  /** 복사하고 나서 화면이 할 말. 담긴 것이 서식까지인지 글자뿐인지를 가려 말한다. */
  const [copied, setCopied] = useState('')

  // 복사 안내는 잠깐만 띄운다. 창이 닫히면 타이머도 같이 거둔다.
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(''), 4000)
    return () => window.clearTimeout(t)
  }, [copied])

  const endpoint = useCallback(
    (format: string) => `/api/meeting-notes/${meetingNoteId}/export?view=${view}&format=${format}`,
    [meetingNoteId, view],
  )

  // 미리보기 로드 — 서버가 산출과 동일한 문서 HTML을 준다(브라우저 엔진 미개입).
  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    fetch(endpoint('html'))
      .then(async (res) => {
        if (!res.ok) {
          const reason = await res.json().then((j) => (typeof j?.error === 'string' ? j.error : '')).catch(() => '')
          throw new Error(reason || '미리보기를 불러오지 못했습니다.')
        }
        return res.text()
      })
      .then((text) => { if (alive) { setHtml(text); setLoading(false) } })
      .catch((e: unknown) => {
        if (!alive) return
        setErr(e instanceof Error ? e.message : '미리보기를 불러오지 못했습니다.')
        setLoading(false)
      })
    return () => { alive = false }
  }, [endpoint])

  /**
   * 파일로 받지 않고 바로 붙여넣는 길.
   *
   * 미리보기로 이미 받아 둔 문서를 그대로 쓴다 — 복사용 문서를 따로 만들면 화면에서 본 것과
   * 붙여넣은 것이 갈라지고, 그 어긋남은 붙여넣어 봐야만 드러난다.
   */
  async function copy() {
    if (!canCopy) return
    setErr(''); setCopied('')
    try {
      const how = await copyExportDocument(html)
      setCopied(how === 'rich' ? '서식까지 복사했습니다' : '글자만 복사했습니다 (이 브라우저는 서식을 못 담습니다)')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '복사하지 못했습니다.')
    }
  }

  async function download(format: 'pdf' | 'png') {
    if (saving) return
    setSaving(format); setErr(''); setCopied('')
    try {
      const res = await fetch(endpoint(format))
      if (!res.ok) {
        const reason = await res.json().then((j) => (typeof j?.error === 'string' ? j.error : '')).catch(() => '')
        setErr(reason || '내보내기에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''([^;]+)/)
      const filename = m ? decodeURIComponent(m[1]) : `회의록.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setErr('내보내기 중 오류가 발생했습니다.')
    } finally {
      setSaving(null)
    }
  }

  const busy = loading || !!err || !!saving
  /**
   * 복사는 오류가 떠도 다시 누를 수 있어야 한다 — 저장 단추는 `err` 에 잠기는데(기존 동작),
   * 복사까지 잠그면 「한 번 실패하면 창을 닫았다 열어야」 한다. 미리보기만 있으면 복사는 된다.
   */
  const canCopy = !loading && !saving && !!html

  return (
    <NbModal
      title="내보내기 미리보기"
      onClose={onClose}
      maxWidth={880}
      ariaLabel="내보내기 미리보기"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <span role={err || copied ? 'alert' : undefined}
            style={{ fontSize: 'var(--fs-sm)', color: err ? 'var(--danger)' : copied ? 'var(--text-muted)' : 'var(--text-faint)' }}>
            {err || copied || '복사해서 바로 붙여넣거나, 형식을 골라 파일로 받습니다.'}
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <NbButton variant="secondary" onClick={copy} disabled={!canCopy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? '복사됨' : '복사'}
            </NbButton>
            <NbButton variant="secondary" onClick={() => download('png')} disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <ImageIcon size={15} /> {saving === 'png' ? '저장 중…' : '이미지로 저장'}
            </NbButton>
            <NbButton onClick={() => download('pdf')} disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <FileDown size={15} /> {saving === 'pdf' ? '저장 중…' : 'PDF로 저장'}
            </NbButton>
          </div>
        </div>
      }
    >
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
        {EXPORT_VIEW_LABEL[view]} 기준입니다. 아래 모습 그대로 저장됩니다.
      </p>

      <div>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10) 0' }}>
            <AXDotLoader />
          </div>
        )}
        {!loading && !err && (
          // sandbox="" — 스크립트·폼·팝업 전부 차단. 문서는 정적 HTML이라 아무것도 필요 없다.
          <iframe
            title="회의록 미리보기"
            srcDoc={html}
            sandbox=""
            className={styles.previewFrame}
          />
        )}
        {!loading && err && <ErrorState message={err} />}
      </div>
    </NbModal>
  )
}
