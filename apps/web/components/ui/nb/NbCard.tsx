// Neo-brutalism 공용 카드 — 디자인 SSOT.
// .card 클래스(globals.css)를 감싸는 얇은 래퍼. 제목은 tape 라벨로 통일.
import type { HTMLAttributes, ReactNode } from 'react'

interface NbCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  headerRight?: ReactNode
  children: ReactNode
}

export default function NbCard({ title, headerRight, children, className, style, ...rest }: NbCardProps) {
  return (
    <div className={`card${className ? ' ' + className : ''}`} style={{ padding: '1.25rem 1.5rem', ...style }} {...rest}>
      {(title || headerRight) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.75rem' }}>
          {title ? <span className="tape-title">{title}</span> : <span />}
          {headerRight}
        </div>
      )}
      {children}
    </div>
  )
}
