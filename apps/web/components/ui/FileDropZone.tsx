'use client'

// 파일 놓는 자리 — 끌어다 놓기와 눌러서 고르기를 한 자리에서
//
// 끌어 놓기가 화면마다 따로 있었다(IntakeModal·UploadPanel·LeadIntakeForm·QuoteRegisterTab).
// 가격표 가져오기는 브라우저 기본 파일 칸만 있어 끌어 놓으면 브라우저가 파일을 새 탭으로 열었다.
// 받는 형식 거름은 화면 편의다 — 서버 창구의 검사가 진짜 관문이다.

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { FileUp, FileCheck2 } from 'lucide-react'
import { FILE_DROP } from '@/lib/terms/attachment'
import styles from './file-drop-zone.module.css'

interface Props {
  file: File | null
  onChange: (file: File) => void
  /** 받는 확장자, 점 포함 — ['.xlsx', '.pdf'] */
  accept: readonly string[]
  /** 사람이 읽는 형식 이름 — 「엑셀, PDF, 워드」 */
  kindsLabel: string
  disabled?: boolean
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

export default function FileDropZone({ file, onChange, accept, kindsLabel, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const take = (f: File | undefined) => {
    if (!f) return
    if (!accept.includes(extOf(f.name))) { setRejected(FILE_DROP.rejected(f.name, kindsLabel)); return }
    setRejected(null)
    onChange(f)
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (!disabled) setOver(true)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled) take(e.dataTransfer.files[0])
  }

  const pick = () => { if (!disabled) inputRef.current?.click() }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() }
  }

  const cls = [styles.zone, over ? styles.over : '', file ? styles.filled : '', disabled ? styles.disabled : ''].join(' ')
  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        className={cls}
        onClick={pick}
        onKeyDown={onKey}
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {file ? <FileCheck2 size={22} aria-hidden className={styles.icon} /> : <FileUp size={22} aria-hidden className={styles.icon} />}
        {file ? (
          <>
            <span className={styles.name}>{file.name}</span>
            <span className={styles.hint}>{over ? FILE_DROP.over : FILE_DROP.replace}</span>
          </>
        ) : (
          <>
            <span className={styles.prompt}>{over ? FILE_DROP.over : FILE_DROP.prompt}</span>
            <span className={styles.hint}>{FILE_DROP.accepts(kindsLabel)}</span>
          </>
        )}
        {/* 고르는 창은 이 면이 연다 — 브라우저 기본 파일 칸은 테마가 안 먹는다 */}
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          accept={accept.join(',')}
          disabled={disabled}
          onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>
      {rejected && <p role="alert" className={styles.rejected}>{rejected}</p>}
    </div>
  )
}
