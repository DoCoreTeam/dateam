'use client'

import { useRef, useState } from 'react'
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react'

interface BrandingSettingsProps {
  initialLogoUrl: string | null
  initialBrandName: string
  initialTagline: string
}

export default function BrandingSettings({ initialLogoUrl, initialBrandName, initialTagline }: BrandingSettingsProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [brandName, setBrandName] = useState(initialBrandName)
  const [tagline, setTagline] = useState(initialTagline)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const fd = new FormData()
      fd.append('brandName', brandName)
      fd.append('tagline', tagline)
      if (selectedFile) fd.append('logoFile', selectedFile)

      const res = await fetch('/api/admin/settings/branding', { method: 'POST', body: fd })
      const json = await res.json() as { success?: boolean; logoUrl?: string | null; error?: string }

      if (!res.ok) throw new Error(json.error ?? '저장 실패')

      if (json.logoUrl !== undefined) setLogoUrl(json.logoUrl ?? null)
      setPreviewUrl(null)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setMessage({ type: 'success', text: '저장되었습니다. 다음 페이지 로드 시 전체 반영됩니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '저장 중 오류가 발생했습니다' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLogo = async () => {
    if (!confirm('로고를 삭제하시겠습니까?')) return
    setSaving(true)
    setMessage(null)
    try {
      const fd = new FormData()
      fd.append('deleteLogo', 'true')
      const res = await fetch('/api/admin/settings/branding', { method: 'POST', body: fd })
      const json = await res.json() as { success?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? '삭제 실패')
      setLogoUrl(null)
      setPreviewUrl(null)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setMessage({ type: 'success', text: '로고가 삭제되었습니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다' })
    } finally {
      setSaving(false)
    }
  }

  const displayUrl = previewUrl ?? logoUrl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 로고 미리보기 */}
      <div>
        <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.75rem' }}>로고 이미지</p>
        <div
          style={{
            width: '200px',
            height: '80px',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--surface-bg)',
            overflow: 'hidden',
          }}
        >
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt={brandName}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={() => { setLogoUrl(null); setPreviewUrl(null) }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)' }}>
              <ImageIcon size={24} />
              <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>로고</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.375rem 0.75rem', fontSize: '0.8125rem', fontWeight: 500,
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius)',
              backgroundColor: 'white', color: 'var(--text)', cursor: 'pointer',
            }}
          >
            <Upload size={13} /> 파일 선택
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' }}
              onChange={handleFileChange}
            />
          </label>
          {logoUrl && !previewUrl && (
            <button
              type="button"
              onClick={handleDeleteLogo}
              disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.375rem 0.75rem', fontSize: '0.8125rem', fontWeight: 500,
                border: '1px solid var(--danger-border)', borderRadius: 'var(--radius)',
                backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', cursor: 'pointer',
              }}
            >
              <Trash2 size={13} /> 로고 삭제
            </button>
          )}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem' }}>
          PNG / JPG / SVG / WebP · 최대 2MB · 권장: 가로 400px 이상
        </p>
      </div>

      {/* 브랜드명 */}
      <div>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: '0.5rem' }}>
          시스템 이름 (브랜드명)
        </label>
        <input
          type="text"
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          maxLength={30}
          placeholder="AX사업본부"
          className="input-field"
          style={{ maxWidth: '300px' }}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          로고 이미지가 없을 때 표시됩니다 · 최대 30자
        </p>
      </div>

      {/* 부제목 (로그인 페이지 등) */}
      <div>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: '0.5rem' }}>
          부제목
        </label>
        <input
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={40}
          placeholder="본부 운영 플랫폼"
          className="input-field"
          style={{ maxWidth: '300px' }}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          로그인 화면 브랜드명 아래에 표시됩니다 · 최대 40자 · 비우면 숨김
        </p>
      </div>

      {/* 저장 버튼 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
          style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
        {message && (
          <p style={{ fontSize: '0.8125rem', color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}
