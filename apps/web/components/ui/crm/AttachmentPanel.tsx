'use client'

// 첨부 — 명함 사진·계약서·증빙을 **이 건과 함께** 둔다
//
// **왜 한 부품인가**: 딜·회사·인물·미팅이 전부 같은 일을 한다.
// 화면마다 만들면 어느 한 곳만 민감도 처리를 빠뜨리고, 그 한 곳으로 원가가 샌다.
//
// **대외비는 목록에서도 빠진다.** 서버가 걸러서 준다 —
// 「볼 수 없습니다」로 남기면 그런 파일이 있다는 사실 자체가 샌다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Trash2, Download } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { ACTION, progress } from '@/lib/terms'
import {
  ATTACHMENT, ATTACHMENT_KIND_LABEL, ATTACHMENT_KIND_ORDER,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_OK,
  type AttachmentKind, type AttachmentTarget,
} from '@/lib/terms/attachment'
import styles from './attachment-panel.module.css'

interface Item {
  id: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  kind: AttachmentKind
  sensitivity: string
  createdAt: string
}

interface Props {
  target: AttachmentTarget
  targetId: string
  /** 기본 종류 — 인물 화면이면 명함, 딜이면 계약서처럼 자리마다 다르다 */
  defaultKind?: AttachmentKind
}

export default function AttachmentPanel({ target, targetId, defaultKind = 'OTHER' }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [kind, setKind] = useState<AttachmentKind>(defaultKind)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/attachments?target=${target}&targetId=${targetId}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '첨부를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('첨부를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [target, targetId])

  useEffect(() => { void load() }, [load])

  const upload = useCallback(async (file: File) => {
    /*
      **누르기 전에 막는다.** 서버도 막지만, 20MB 를 올려 보내고 나서 거절당하면
      기다린 시간이 통째로 버려진다.
    */
    if (file.size > ATTACHMENT_MAX_BYTES) { setError(ATTACHMENT.tooBig); return }
    if (!ATTACHMENT_MIME_OK.includes(file.type)) { setError(ATTACHMENT.badType); return }

    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('target', target)
      form.append('targetId', targetId)
      form.append('kind', kind)
      const res = await fetch('/api/crm/attachments', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? ATTACHMENT.failed); return }
      await load()
    } catch {
      setError(ATTACHMENT.failed)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [kind, load, target, targetId])

  const download = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/attachments/${id}/url`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '내려받지 못했습니다.'); return }
      // 잠깐 열리는 주소라 그 자리에서 연다 — 저장해 두면 만료된 링크가 남는다
      window.open(body.url, '_blank', 'noopener')
    } catch {
      setError('내려받지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/attachments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        setError(body?.error?.message ?? '지우지 못했습니다.')
        return
      }
      await load()
    } catch {
      setError('지우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [load])

  if (loading && items.length === 0) return <AXDotLoader />

  return (
    <div className={styles.wrap}>
      {error && <ErrorState message={error} />}

      <div className={styles.tools}>
        <select
          className="input-field"
          aria-label="첨부 종류"
          value={kind}
          onChange={(e) => setKind(e.target.value as AttachmentKind)}
          style={{ width: 'auto', minWidth: 120 }}
        >
          {ATTACHMENT_KIND_ORDER.map((k) => (
            <option key={k} value={k}>{ATTACHMENT_KIND_LABEL[k]}</option>
          ))}
        </select>
        <NbButton variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Paperclip size={14} /> {uploading ? progress(ATTACHMENT.add) : ATTACHMENT.add}
        </NbButton>
        {/* 파일 입력은 숨긴다 — 브라우저 기본 모양이 우리 화면과 너무 다르다 */}
        <input
          ref={fileRef}
          type="file"
          /*
            표준 클래스를 함께 단다(§2-1). 숨겨서 안 보이더라도 붙여 두는 이유는
            나중에 누가 `display:none` 을 걷어냈을 때 브라우저 기본 모양으로
            튀어나오지 않게 하려는 것이다 — 가드도 같은 이유로 이걸 요구한다.
          */
          className={`input-field ${styles.hiddenFile}`}
          accept={ATTACHMENT_MIME_OK.join(',')}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState title={ATTACHMENT.empty} description={ATTACHMENT.emptyHint} />
      ) : (
        <ul className={styles.list}>
          {items.map((it) => (
            <li key={it.id} className={styles.item}>
              <span className={styles.name}>
                {it.fileName}
                <span className={styles.kind}>{ATTACHMENT_KIND_LABEL[it.kind]}</span>
                {it.sensitivity === 'RESTRICTED' && (
                  <span className={styles.restricted}>{ATTACHMENT.restricted}</span>
                )}
              </span>
              <span className={styles.size}>{humanSize(it.sizeBytes)}</span>
              <button type="button" className={styles.act} onClick={() => void download(it.id)} aria-label={`${it.fileName} 내려받기`}>
                <Download size={14} />
              </button>
              <button type="button" className={`${styles.act} ${styles.danger}`} onClick={() => void remove(it.id)} aria-label={`${it.fileName} ${ACTION.delete}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 「1.2MB」 — 바이트 숫자는 사람에게 뜻이 없다 */
function humanSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
