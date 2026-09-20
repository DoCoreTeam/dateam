'use client'

// 원본 대조 — 읽어 온 파일과 만들어진 견적서를 **한 화면에 나란히** 세운다
//
// **왜 필요한가**: 파일에서 읽은 견적은 「제대로 읽혔나」를 반드시 한 번 묻게 된다.
// 그때까지 있던 길은 문서 맨 아래 첨부 절의 내려받기 링크뿐이었다 — 새 탭으로 열어
// 눈으로 오가야 했고, 사용자는 그것을 «대조 기능이 없다»로 읽었다
// (사용자 지적 2026-09-20: 「원본 캡쳐되어서 대조 할 수 있는 기능이 안보이는데」).
//
// **원본을 고르는 규칙은 여기 한 곳에 있다.** 단추도 오버레이도 같은 목록에서 같은 규칙으로
// 고른다 — 두 곳이 각자 고르면 「단추는 떴는데 열면 다른 파일」이 된다.
//
// **프레임을 쓰는 이유**: 플러그인 길(`<embed>`·`<object>`)은 CSP 가 통째로 막고 있어
// PDF 를 화면 «안»에 그리는 길이 프레임뿐이다. 그래서 프레임에 우리 blob 만 허용하도록
// 열어 두었다(middleware.ts). 바깥 주소는 여전히 못 들어온다.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Columns2, X, Download, Paperclip } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import { useEscClose } from '@/lib/use-esc-close'
import { QUOTE_SOURCE, PREVIEW_CLOSE, progress } from '@/lib/terms'
import { ATTACHMENT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_OK } from '@/lib/terms/attachment'
import styles from './quote-original-compare.module.css'

interface Attachment {
  id: string
  fileName: string
  mimeType: string | null
  kind: string
  createdAt: string
}

/** 화면 안에 그릴 수 있는 형식인가 */
export type DrawKind = 'pdf' | 'image' | 'other'

export function drawKindOf(mimeType: string | null | undefined): DrawKind {
  const m = (mimeType ?? '').toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('image/')) return 'image'
  return 'other'
}

/**
 * 이 견적의 «원본»은 어느 첨부인가. **한 곳에서만 고른다.**
 *
 * 매입 견적서(`SUPPLY_QUOTE`)가 먼저다 — 파일로 가져오기가 원본을 붙일 때 쓰는 종류이고,
 * 이 화면의 올리기도 같은 종류로 붙인다. 그 종류가 하나도 없을 때만 나머지를 본다:
 * 사람이 첨부 절에서 종류를 다르게 골라 올린 원본을 「없다」고 하면, 파일은 붙어 있는데
 * 대조는 안 되는 상태가 된다.
 *
 * 같은 종류가 여럿이면 **가장 나중 것**이다. 다시 올렸다는 것은 앞의 것이 틀렸다는 뜻이다.
 */
export function pickOriginal(items: Attachment[]): Attachment | null {
  const newest = (list: Attachment[]) =>
    [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  const supply = items.filter((i) => i.kind === 'SUPPLY_QUOTE')
  return newest(supply) ?? newest(items)
}

interface Props {
  quoteId: string
  /**
   * 오른쪽 칸에 세울 견적서.
   *
   * **부품이 직접 그리지 않는다.** 견적서 그리기는 이 견적 화면(route)의 것이고,
   * 공용 부품이 거기로 손을 뻗으면 부품과 화면이 서로를 부르게 된다.
   */
  sheet: ReactNode
  /** 목록이 바뀌었을 때(원본을 새로 올렸을 때) 바깥에 알린다 — 첨부 절도 같이 갱신돼야 한다 */
  onChanged?: () => void
  /**
   * 원본이 붙어 있나를 바깥에 알린다.
   *
   * 화면은 이 값으로 「파일에서 왔는데 원본이 없다」는 줄을 그린다 — 목록을 두 번 읽지 않게
   * 여기서 한 번 읽고 결과만 넘긴다. 아직 모르면 null 이다(첫 렌더에 「없다」고 말하지 않는다).
   */
  onOriginal?: (has: boolean) => void
}

export default function QuoteOriginalCompare({ quoteId, sheet, onChanged, onOriginal }: Props) {
  const [items, setItems] = useState<Attachment[] | null>(null)
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/attachments?target=QUOTE&targetId=${quoteId}`)
      const body = await res.json()
      return (res.ok ? (body.items ?? []) : []) as Attachment[]
    } catch {
      // 목록을 못 읽으면 «원본이 없다»와 같게 다룬다 — 단추가 떴는데 아무 일도 안 일어나는 것보다 낫다
      return [] as Attachment[]
    }
  }, [quoteId])

  useEffect(() => {
    let dead = false
    void load().then((got) => {
      if (dead) return
      setItems(got)
      onOriginal?.(pickOriginal(got) !== null)
    })
    return () => { dead = true }
    // onOriginal 을 의존에 넣으면 부모가 인라인 함수를 줄 때마다 목록을 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  /**
   * 원본을 올린다. **창구도 제한도 첨부 절과 같은 것을 쓴다** —
   * 여기만 따로 열면 한쪽에서 거절하는 파일을 다른 쪽에서 받는다.
   *
   * 올라가면 **바로 대조 화면을 연다.** 올리는 이유가 대조인데 한 번 더 누르게 하면
   * 「올렸는데 아무 일도 안 일어난다」가 된다.
   */
  const upload = useCallback(async (file: File) => {
    if (file.size > ATTACHMENT_MAX_BYTES) { setError(ATTACHMENT.tooBig); return }
    if (!ATTACHMENT_MIME_OK.includes(file.type)) { setError(ATTACHMENT.badType); return }

    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('target', 'QUOTE')
      form.append('targetId', quoteId)
      // 종류가 대외비 등급을 정한다 — 여기서 등급을 따로 고르지 않는다
      form.append('kind', 'SUPPLY_QUOTE')
      const res = await fetch('/api/crm/attachments', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? ATTACHMENT.failed); return }
      const got = await load()
      setItems(got)
      onOriginal?.(pickOriginal(got) !== null)
      onChanged?.()
      if (pickOriginal(got)) setOpen(true)
    } catch {
      setError(ATTACHMENT.failed)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [load, onChanged, onOriginal, quoteId])

  // 목록을 아직 못 읽었으면 자리를 비워 둔다 — 단추가 깜빡이며 바뀌는 것보다 낫다
  if (items === null) return null

  const original = pickOriginal(items)

  return (
    <>
      {error && <span className={styles.error}>{error}</span>}
      {original ? (
        <NbButton variant="ghost" onClick={() => setOpen(true)}>
          <Columns2 size={16} /> {QUOTE_SOURCE.compare}
        </NbButton>
      ) : (
        <NbButton variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Paperclip size={16} /> {uploading ? progress(QUOTE_SOURCE.upload) : QUOTE_SOURCE.upload}
        </NbButton>
      )}
      {/* 파일 입력은 숨긴다 — 브라우저 기본 모양이 우리 화면과 너무 다르다(§2-1 표준 클래스는 함께 단다) */}
      <input
        ref={fileRef}
        type="file"
        className={`input-field ${styles.hiddenFile}`}
        accept={ATTACHMENT_MIME_OK.join(',')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
      />
      {open && original && (
        <CompareOverlay original={original} sheet={sheet} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function CompareOverlay({ original, sheet, onClose }: {
  original: Attachment
  sheet: ReactNode
  onClose: () => void
}) {
  useEscClose(onClose)

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 거두어야 할 주소. state 로만 두면 정리 함수가 옛 값을 본다 */
  const madeRef = useRef<string | null>(null)

  const draw = drawKindOf(original.mimeType)

  useEffect(() => {
    if (draw === 'other') return
    let dead = false

    void (async () => {
      try {
        const res = await fetch(`/api/crm/attachments/${original.id}/url`)
        const body = await res.json()
        if (!res.ok) { if (!dead) setError(body?.error?.message ?? QUOTE_SOURCE.loadFailed); return }
        /*
          **주소를 화면에 들고 있지 않는다.** 서명 주소는 5분 열리는 문이라
          state 나 주소창에 남으면 그 문이 기록에 남는다. 바이트만 받아 우리 blob 으로 바꾼다.
        */
        const file = await fetch(body.url)
        if (!file.ok) { if (!dead) setError(QUOTE_SOURCE.loadFailed); return }
        const bytes = await file.arrayBuffer()
        // 형식은 우리가 아는 값으로 박는다 — 내려받기용 주소라 응답 헤더가 첨부로 올 수 있다
        const url = URL.createObjectURL(new Blob([bytes], { type: original.mimeType ?? 'application/octet-stream' }))
        if (dead) { URL.revokeObjectURL(url); return }
        madeRef.current = url
        setBlobUrl(url)
      } catch {
        if (!dead) setError(QUOTE_SOURCE.loadFailed)
      }
    })()

    return () => {
      dead = true
      // 안 거두면 견적을 여닫을 때마다 원본 한 벌이 메모리에 그대로 쌓인다
      if (madeRef.current) { URL.revokeObjectURL(madeRef.current); madeRef.current = null }
    }
  }, [draw, original.id, original.mimeType])

  const download = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/attachments/${original.id}/url`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? QUOTE_SOURCE.loadFailed); return }
      window.open(body.url, '_blank', 'noopener')
    } catch {
      setError(QUOTE_SOURCE.loadFailed)
    }
  }, [original.id])

  if (!mounted) return null

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={QUOTE_SOURCE.compareTitle}>
      <header className={styles.bar}>
        <h2 className={styles.title}>{QUOTE_SOURCE.compareTitle}</h2>
        <span className={styles.fileName}>{original.fileName}</span>
        <div className={styles.barActions}>
          <NbButton variant="ghost" onClick={() => void download()}>
            <Download size={16} /> {QUOTE_SOURCE.download}
          </NbButton>
          <button type="button" className={styles.close} onClick={onClose} aria-label={PREVIEW_CLOSE}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div className={styles.panes}>
        <section className={styles.pane} aria-label={QUOTE_SOURCE.paneOriginal}>
          <h3 className={styles.paneTitle}>{QUOTE_SOURCE.paneOriginal}</h3>
          <div className={styles.paneBody}>
            {error && <ErrorState message={error} />}
            {!error && draw === 'other' && (
              <div className={styles.note}>
                <strong>{QUOTE_SOURCE.cannotDraw}</strong>
                <span>{QUOTE_SOURCE.cannotDrawHint}</span>
              </div>
            )}
            {!error && draw !== 'other' && !blobUrl && (
              <div className={styles.waiting}>
                <AXDotLoader />
                <span>{progress(QUOTE_SOURCE.paneOriginal)}</span>
              </div>
            )}
            {!error && blobUrl && draw === 'pdf' && (
              /*
                **쪽 목록을 접고 폭에 맞춰 연다.** 기본값으로 열면 왼쪽 절반을 쪽 그림이
                차지하고 본문이 39% 로 줄어든다(실측) — 대조하려고 연 화면에서 정작
                원본 글자가 안 읽힌다. 뒤에 붙는 값은 브라우저 뷰어가 읽는 것이라
                파일 내용이나 주소에 영향을 주지 않는다.
              */
              <iframe className={styles.frame} src={`${blobUrl}#navpanes=0&view=FitH`} title={original.fileName} />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!error && blobUrl && draw === 'image' && (
              <img className={styles.image} src={blobUrl} alt={original.fileName} />
            )}
          </div>
        </section>

        <section className={styles.pane} aria-label={QUOTE_SOURCE.paneQuote}>
          <h3 className={styles.paneTitle}>{QUOTE_SOURCE.paneQuote}</h3>
          <div className={`${styles.paneBody} ${styles.sheetBody}`}>{sheet}</div>
        </section>
      </div>
    </div>,
    document.body,
  )
}
