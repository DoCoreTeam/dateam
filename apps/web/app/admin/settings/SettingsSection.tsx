import type { ReactNode } from 'react'

// 설정 화면의 섹션 머리 — 섹션마다 제목 타이포를 인라인으로 다시 쓰던 것을 하나로 묶는다.
// (기존 페이지는 어떤 섹션은 tape-title, 어떤 섹션은 raw h2 + 인라인 style이라 크기가 갈렸다.)

interface Props {
  title: string
  desc?: string
  children: ReactNode
}

export default function SettingsSection({ title, desc, children }: Props) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2 className="tape-title" style={{ margin: 0 }}>{title}</h2>
        {desc && <p className="settings-section-desc">{desc}</p>}
      </div>
      {children}
    </section>
  )
}
