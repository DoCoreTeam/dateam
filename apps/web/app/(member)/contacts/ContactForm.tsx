'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, ImageOff, RefreshCw } from 'lucide-react'
import type { Contact, Account } from '@/types/database'
import { CONTACT_ROLES } from '@/lib/crm'

interface Props {
  contact?: Contact
  accounts: Pick<Account, 'id' | 'name'>[]
  defaultAccountId?: string
}

export default function ContactForm({ contact, accounts, defaultAccountId }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    account_id: contact?.account_id ?? defaultAccountId ?? '',
    title: contact?.title ?? '',
    department: contact?.department ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    mobile: contact?.mobile ?? '',
    linkedin: contact?.linkedin ?? '',
    role: contact?.role ?? '',
    notes: contact?.notes ?? '',
  })

  const [businessCardDriveId, setBusinessCardDriveId] = useState<string | null>(
    contact?.business_card_drive_id ?? null
  )
  const [cardUploading, setCardUploading] = useState(false)
  const [cardUploadError, setCardUploadError] = useState('')
  const [driveAvailable, setDriveAvailable] = useState<boolean | null>(null)

  // Drive 연결 여부 확인 (첫 클릭 시 lazy 체크)
  async function checkDriveAvailable(): Promise<boolean> {
    if (driveAvailable !== null) return driveAvailable
    try {
      const res = await fetch('/api/auth/google-drive/status')
      if (!res.ok) { setDriveAvailable(false); return false }
      const d = await res.json() as { connected: boolean }
      setDriveAvailable(d.connected)
      return d.connected
    } catch {
      setDriveAvailable(false)
      return false
    }
  }

  async function handleCardClick() {
    setCardUploadError('')
    const ok = await checkDriveAvailable()
    if (!ok) {
      setCardUploadError('관리자가 Google Drive를 연결해야 합니다')
      return
    }
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // 클라이언트 사이드 검증
    if (!file.type.startsWith('image/')) {
      setCardUploadError('이미지 파일만 업로드 가능합니다')
      e.target.value = ''
      return
    }
    const MAX_BYTES = 10 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      setCardUploadError('파일 크기는 10MB 이하여야 합니다')
      e.target.value = ''
      return
    }

    setCardUploading(true)
    setCardUploadError('')

    const fd = new FormData()
    fd.append('file', file)

    try {
      const res = await fetch('/api/files/drive/upload', { method: 'POST', body: fd })
      const d = await res.json() as { fileId?: string; error?: string }
      if (!res.ok) {
        setCardUploadError(d.error ?? '업로드 실패')
      } else if (d.fileId) {
        setBusinessCardDriveId(d.fileId)
      }
    } catch {
      setCardUploadError('업로드 중 오류가 발생했습니다')
    } finally {
      setCardUploading(false)
      e.target.value = ''
    }
  }

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('이름을 입력하세요'); return }
    setLoading(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      account_id: form.account_id || null,
      title: form.title || null,
      department: form.department || null,
      email: form.email || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      linkedin: form.linkedin || null,
      role: form.role || null,
      notes: form.notes || null,
      business_card_drive_id: businessCardDriveId,
    }

    const url = contact ? `/api/contacts/${contact.id}` : '/api/contacts'
    const method = contact ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json() as { id?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '저장 실패'); setLoading(false); return }
    router.push(`/contacts/${data.id ?? contact?.id}`)
    router.refresh()
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: '0.875rem', boxSizing: 'border-box' as const }

  const cardPreviewUrl = businessCardDriveId ? `/api/files/drive/${businessCardDriveId}` : null

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit() } }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {/* 명함 이미지 업로드 */}
        <div>
          <label className="label">명함 이미지</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="명함 이미지 파일 선택"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <div
            onClick={cardUploading ? undefined : handleCardClick}
            role="button"
            tabIndex={0}
            aria-label={businessCardDriveId ? '명함 이미지 변경' : '명함 이미지 업로드'}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!cardUploading) handleCardClick() } }}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '240px',
              aspectRatio: '1.7 / 1',
              border: '2px dashed var(--color-border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              cursor: cardUploading ? 'not-allowed' : 'pointer',
              backgroundColor: 'var(--color-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '0.375rem',
              transition: 'border-color 150ms',
            }}
          >
            {cardUploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', color: '#94a3b8' }}>
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '0.75rem' }}>업로드 중...</span>
              </div>
            ) : cardPreviewUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardPreviewUrl}
                  alt="명함 이미지 미리보기"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none'
                    const el = e.currentTarget.nextElementSibling as HTMLElement | null
                    if (el) el.style.display = 'flex'
                  }}
                />
                <div
                  style={{
                    display: 'none',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.375rem',
                    color: '#94a3b8',
                    position: 'absolute',
                    inset: 0,
                    justifyContent: 'center',
                  }}
                >
                  <ImageOff size={18} />
                  <span style={{ fontSize: '0.75rem' }}>미리보기 불가</span>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: '0.375rem',
                    right: '0.375rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.25rem 0.5rem',
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    borderRadius: '0.375rem',
                    color: '#fff',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                  }}
                >
                  <RefreshCw size={10} />
                  변경
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem', color: '#94a3b8' }}>
                <Camera size={20} />
                <span style={{ fontSize: '0.75rem' }}>클릭하여 업로드</span>
                <span style={{ fontSize: '0.6875rem', color: '#cbd5e1' }}>이미지, 최대 10MB</span>
              </div>
            )}
          </div>
          {cardUploadError && (
            <p style={{ color: '#dc2626', fontSize: '0.8125rem', margin: '0.375rem 0 0 0' }}>{cardUploadError}</p>
          )}
        </div>

        <div>
          <label className="label">이름 *</label>
          <input className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} required style={inputStyle} />
        </div>
        <div>
          <label className="label">거래처</label>
          <select className="input-field" value={form.account_id} onChange={(e) => set('account_id', e.target.value)} style={inputStyle}>
            <option value="">선택 (없음)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
          <div>
            <label className="label">직함/직책</label>
            <input className="input-field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="팀장" style={inputStyle} />
          </div>
          <div>
            <label className="label">부서</label>
            <input className="input-field" value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="IT기획팀" style={inputStyle} />
          </div>
          <div>
            <label className="label">이메일</label>
            <input className="input-field" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">직통 전화</label>
            <input className="input-field" value={form.phone} onChange={(e) => set('phone', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">휴대폰</label>
            <input className="input-field" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">LinkedIn</label>
            <input className="input-field" value={form.linkedin} onChange={(e) => set('linkedin', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">역할</label>
            <select className="input-field" value={form.role} onChange={(e) => set('role', e.target.value)} style={inputStyle}>
              <option value="">선택</option>
              {CONTACT_ROLES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">메모</label>
          <textarea className="input-field" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="submit" disabled={loading} className="btn-primary" style={{ minHeight: '44px', padding: '0.625rem 1.5rem' }}>
            {loading ? '저장중...' : contact ? '수정' : '담당자 등록'}{!loading && <span style={{ fontSize: '0.7rem', opacity: 0.65, marginLeft: '0.375rem' }}>Ctrl+↵</span>}
          </button>
          <button type="button" onClick={() => router.back()} style={{ minHeight: '44px', padding: '0.625rem 1.25rem', background: 'none', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
            취소
          </button>
        </div>
      </form>
    </div>
  )
}
