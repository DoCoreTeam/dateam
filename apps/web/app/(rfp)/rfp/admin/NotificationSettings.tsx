'use client'

// 받은 알림 — **읽기만 한다**.
//
// `rfp_notifications` 는 창구가 이미 있었는데 화면이 0개였다(실측 2026-09-16).
// 표도 있고 창구도 있고 알림도 쌓이는데 볼 자리가 없었다.
//
// **어떤 알림을 받을지 고르는 자리는 아직 없다.** 그래서 고를 수 있는 것처럼 두지 않고,
// 읽기만 된다고 화면이 말한다. 스위치를 먼저 그려 놓고 저장을 나중에 붙이는 것이
// 이 저장소가 이상 조항 규칙에서 한 번 한 실수다.

import { useEffect, useState } from 'react'
import NbBadge from '@/components/ui/nb/NbBadge'
import { RFP_ADMIN, NOTIFY_KIND_LABEL } from '@/lib/rfp/terms'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import styles from '@/app/(rfp)/rfp.module.css'

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  created_at: string
}

export default function NotificationSettings() {
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/rfp/notifications', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as { notifications?: NotificationRow[] }
        if (alive) setRows(json.notifications ?? [])
      } catch {
        if (alive) { setFailed(true); setRows([]) }
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <section className="card">
      <div className={styles.sectionHead}>
        <div className={styles.between}>
          <span className={styles.sectionTitle}>{RFP_ADMIN.notifications}</span>
          {rows && <NbBadge status="note">{rows.length}</NbBadge>}
        </div>
        <p className={styles.sectionDesc}>{RFP_ADMIN.notificationsReadOnly}</p>
      </div>

      {failed && (
        <p role="alert" className={styles.sectionDesc} style={{ color: 'var(--danger)' }}>
          {RFP_ADMIN.notificationsFailed}
        </p>
      )}

      {rows && rows.length === 0 && !failed && (
        <p className={styles.sectionDesc}>{RFP_ADMIN.notificationsEmpty}</p>
      )}

      {rows && rows.length > 0 && (
        <ul className={styles.ruleList}>
          {rows.map((n) => (
            <li key={n.id} className={styles.ruleItem}>
              <NbBadge status="note">{NOTIFY_KIND_LABEL[n.kind] ?? n.kind}</NbBadge>
              <span className={`${styles.ruleName} ${styles.tight}`}>
                <span style={{ fontWeight: 600 }}>{n.title}</span>
                <span className={styles.sectionDesc}>{formatKstDateTimeExact(n.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
