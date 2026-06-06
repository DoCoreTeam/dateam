import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Users, ArrowLeft, Mail, Phone, Linkedin } from 'lucide-react'
import type { Contact, Account } from '@/types/database'

interface PageProps { params: Promise<{ id: string }> }

type ContactWithAccount = Contact & { accounts: Pick<Account, 'id' | 'name'> | null }

export default async function ContactDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any).from('contacts').select('*, accounts(id, name)').eq('id', id).single() as { data: ContactWithAccount | null }
  if (!data) notFound()

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/contacts" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: 'var(--brand)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', marginBottom: '0.75rem' }}>
          <ArrowLeft size={14} /> 담당자 목록
        </Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: '50%', background: 'linear-gradient(135deg, var(--brand), var(--brand))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}>
              {data.name.charAt(0)}
            </div>
            <div>
              <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>{data.name}</h1>
              <div style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.125rem' }}>
                {[data.title, data.department].filter(Boolean).join(' · ')}
                {data.accounts?.name && (
                  <> · <Link href={`/accounts/${data.accounts.id}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>{data.accounts.name}</Link></>
                )}
              </div>
              {data.role && <span className="badge badge-slate" style={{ marginTop: '0.375rem' }}>{data.role}</span>}
            </div>
          </div>
          <Link href={`/contacts/${id}/edit`} className="btn-primary" style={{ textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: 'var(--radius)', fontSize: '0.875rem', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
            편집
          </Link>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '480px', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: '0 0 1rem' }}>연락처 정보</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {data.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Mail size={16} color="var(--brand)" />
              <a href={`mailto:${data.email}`} style={{ color: '#374151', textDecoration: 'none', fontSize: '0.9rem' }}>{data.email}</a>
            </div>
          )}
          {data.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Phone size={16} color="var(--brand)" />
              <span style={{ color: '#374151', fontSize: '0.9rem' }}>{data.phone}</span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>직통</span>
            </div>
          )}
          {data.mobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Phone size={16} color="var(--brand)" />
              <span style={{ color: '#374151', fontSize: '0.9rem' }}>{data.mobile}</span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>휴대폰</span>
            </div>
          )}
          {data.linkedin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Linkedin size={16} color="var(--brand)" />
              <a href={data.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', textDecoration: 'none', fontSize: '0.9rem' }}>LinkedIn 프로필</a>
            </div>
          )}
          {data.notes && (
            <div style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '2px solid var(--border-color)' }}>
              <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6 }}>{data.notes}</p>
            </div>
          )}
          {!data.email && !data.phone && !data.mobile && !data.linkedin && !data.notes && (
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>연락처 정보가 없습니다</p>
          )}
        </div>
      </div>

      {data.business_card_drive_id && (
        <div className="card" style={{ maxWidth: '480px', padding: '1.5rem', marginTop: '1rem' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: '0 0 1rem' }}>명함 이미지</h2>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1.7 / 1', overflow: 'hidden', borderRadius: 'var(--radius)', border: '2px solid var(--border-color)', backgroundColor: 'var(--color-bg)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/drive/${data.business_card_drive_id}`}
              alt="명함"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

