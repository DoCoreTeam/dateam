'use client'

// 공공데이터포털 서비스 여섯 — **무엇이 열려 있는지**와 **무엇을 신청해야 하는지**를 보여 준다.
//
// 키는 하나인데 활용 신청은 서비스마다 따로 하고 일일 한도도 따로 센다.
// 하나를 신청했다고 나머지가 열리지 않는다(기획서 8절).
//
// **신청 버튼을 안 둔다.** 신청은 공공데이터포털에서 사람이 하는 일이라 우리가 대신 못 한다.
// 여기 버튼을 두면 눌러도 아무 일이 없고, 그것이 이 저장소가 이상 조항 규칙에서 한 실수다.
// 대신 **신청했다고 적어 두는** 자리를 둔다 — 적어 두면 화면이 「신청 안 함」과
// 「신청했는데 코드가 아직 안 씀」을 갈라 말할 수 있고, 그 둘은 사용자가 할 일이 다르다.

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import StatusPill, { toneFromStatusKey } from '@/components/ui/settings/StatusPill'
import NbButton from '@/components/ui/nb/NbButton'
import {
  G2B_SERVICES, serviceStatus, stateMap, needsApplyCount,
  type G2bServiceState, type G2bServiceStatus,
} from '@/lib/rfp/g2b/services'
import { RFP_ADMIN, RFP_RADAR, G2B_SERVICE_NAME, G2B_SERVICE_GIVES } from '@/lib/rfp/terms'
import { HOST_AI_SETTINGS_HREF } from '@/lib/rfp/ai/host-providers'
import styles from '@/app/(rfp)/rfp.module.css'

export interface G2bServicesProps {
  /** 서비스 키가 설정돼 있나. 값은 절대 안 받는다 */
  hasServiceKey: boolean
  /** 신청했다고 적어 둔 것 */
  initialStates?: readonly G2bServiceState[]
}

const LABEL: Record<G2bServiceStatus, string> = {
  live: RFP_ADMIN.g2bInUse,
  applied_unused: RFP_ADMIN.g2bAppliedUnused,
  needs_apply: RFP_ADMIN.g2bNeedsApply,
  unknown: RFP_ADMIN.g2bStateUnknown,
}

const TONE: Record<G2bServiceStatus, 'done' | 'note' | 'warn'> = {
  live: 'done',
  applied_unused: 'note',
  // 신청해야 열리는 것은 사용자가 할 일이 있다는 뜻이다. 눈에 띄어야 한다
  needs_apply: 'warn',
  unknown: 'note',
}

export default function G2bServices({ hasServiceKey, initialStates = [] }: G2bServicesProps) {
  const [states, setStates] = useState<readonly G2bServiceState[]>(initialStates)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const byId = stateMap(states)
  const todo = needsApplyCount(G2B_SERVICES, byId)

  async function toggle(serviceId: string, applied: boolean) {
    setBusy(serviceId)
    setError(null)
    try {
      const res = await fetch('/api/rfp/g2b-services', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceId, applied }),
      })
      if (!res.ok) { setError(RFP_ADMIN.g2bAdminOnly); return }
      const body = await res.json()
      const next = (body.states ?? []) as G2bServiceState[]
      // 돌아온 줄만 갈아 끼운다 — 전체를 덮으면 다른 줄이 사라진다
      setStates((prev) => [...prev.filter((p) => !next.some((n) => n.serviceId === p.serviceId)), ...next])
    } catch {
      setError(RFP_ADMIN.g2bAdminOnly)
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsCard
      title={RFP_ADMIN.g2bServices}
      description={RFP_ADMIN.g2bApplyHint}
      headingLevel={2}
      status={{
        tone: toneFromStatusKey(todo > 0 ? 'warn' : 'note'),
        label: todo > 0 ? `${RFP_ADMIN.g2bNeedsApplyCount} ${todo}` : `${G2B_SERVICES.filter((s) => s.inUse).length} / ${G2B_SERVICES.length}`,
      }}
    >
      {/*
        키가 없으면 그 사실을 먼저 말한다. 나머지를 흐리게만 두면 왜 안 되는지 모른다.
        그리고 넣으러 갈 곳을 옆에 둔다 — 주소는 공급자 카드·수집처 카드와 같은 상수를 쓴다
      */}
      {!hasServiceKey && (
        <div role="status" className={styles.tight}>
          <p className={styles.sectionDesc} style={{ color: 'var(--danger)' }}>
            {RFP_ADMIN.g2bNoKey}
          </p>
          <NbButton variant="secondary" href={HOST_AI_SETTINGS_HREF}>
            <ExternalLink size={14} /> {RFP_RADAR.serviceKeyLink}
          </NbButton>
        </div>
      )}

      {error && <p role="alert" className={styles.sectionDesc} style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className={styles.ruleList}>
        {G2B_SERVICES.map((s) => {
          const state = byId.get(s.id)
          const status = serviceStatus(s, state)
          return (
            <div key={s.id} className={styles.ruleItem}>
              <span className={`${styles.ruleName} ${styles.tight}`}>
                <span style={{ fontWeight: 600 }}>{G2B_SERVICE_NAME[s.id] ?? s.id}</span>
                <span className={styles.sectionDesc}>{G2B_SERVICE_GIVES[s.id] ?? ''}</span>
                <span className={styles.sectionDesc}>{RFP_ADMIN.g2bPortalNo} {s.portalNo}</span>
              </span>
              <span className={styles.tight}>
                <StatusPill tone={toneFromStatusKey(TONE[status])}>{LABEL[status]}</StatusPill>
                {/* 신청은 포털에서 한다. 여기서는 했다고 적어 둘 뿐이다 */}
                <NbButton
                  variant="ghost"
                  disabled={busy === s.id}
                  onClick={() => void toggle(s.id, !(state?.applied ?? false))}
                >
                  {state?.applied ? RFP_ADMIN.g2bUnmarkApplied : RFP_ADMIN.g2bMarkApplied}
                </NbButton>
              </span>
            </div>
          )
        })}
      </div>
    </SettingsCard>
  )
}
