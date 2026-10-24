'use client'

// 개발자센터 CLI 명령 절 (P0158 I08)
// 목록은 손으로 적지 않는다, 정의 표 생성물(lib/actions/generated/openapi.json)을 이 절을 열 때만 받아 그린다
import { useEffect, useState } from 'react'
import { API_CLI_DOC } from '@/lib/terms'
import CliDownload from './CliDownload'
import ActionReference from './ActionReference'

export default function CliSection() {
  const [spec, setSpec] = useState<unknown>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    import('@/lib/actions/generated/openapi.json')
      .then((m) => { if (alive) setSpec(m.default ?? m) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  return (
    <section aria-labelledby="cli-title">
      <h2 id="cli-title" style={{ fontSize: 'var(--fs-xl)', margin: '0 0 var(--space-2)' }}>{API_CLI_DOC.title}</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>{API_CLI_DOC.description}</p>
      <CliDownload />
      {failed && <p role="alert">{API_CLI_DOC.failed}</p>}
      {!failed && spec == null && <p role="status">{API_CLI_DOC.loading}</p>}
      {spec != null && <ActionReference spec={spec} />}
    </section>
  )
}
