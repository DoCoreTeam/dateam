import dynamic from 'next/dynamic'

const QuoteRegisterTab = dynamic(
  () => import('../pricing/gpu/tabs/QuoteRegisterTab'),
  { ssr: false }
)

export default function IntakePage() {
  return (
    <div className="page-inner" style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>통합 입력</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>통합 입력</h2>
      </div>
      <QuoteRegisterTab />
    </div>
  )
}
