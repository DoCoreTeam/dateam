'use client'

// 공공데이터포털 서비스 여섯 — **무엇이 열려 있는지만** 보여 준다.
//
// 키는 하나인데 활용 신청은 서비스마다 따로 하고 일일 한도도 따로 센다.
// 하나를 신청했다고 나머지가 열리지 않는다(기획서 8절).
//
// **신청 버튼을 안 둔다.** 신청은 공공데이터포털에서 사람이 하는 일이라 우리가 대신 못 한다.
// 여기 버튼을 두면 눌러도 아무 일이 없고, 그것이 이 저장소가 이상 조항 규칙에서 한 실수다.

import SettingsCard from '@/components/ui/settings/SettingsCard'
import StatusPill, { toneFromStatusKey } from '@/components/ui/settings/StatusPill'
import { G2B_SERVICES } from '@/lib/rfp/g2b/services'
import { RFP_ADMIN, G2B_SERVICE_NAME, G2B_SERVICE_GIVES } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

export interface G2bServicesProps {
  /** 서비스 키가 설정돼 있나. 값은 절대 안 받는다 */
  hasServiceKey: boolean
}

export default function G2bServices({ hasServiceKey }: G2bServicesProps) {
  const inUse = G2B_SERVICES.filter((s) => s.inUse).length

  return (
    <SettingsCard
      title={RFP_ADMIN.g2bServices}
      description={RFP_ADMIN.g2bApplyHint}
      headingLevel={2}
      status={{ tone: toneFromStatusKey('note'), label: `${inUse} / ${G2B_SERVICES.length}` }}
    >
      {/* 키가 없으면 그 사실을 먼저 말한다. 나머지를 흐리게만 두면 왜 안 되는지 모른다 */}
      {!hasServiceKey && (
        <p role="status" className={styles.sectionDesc} style={{ color: 'var(--danger)' }}>
          {RFP_ADMIN.g2bNoKey}
        </p>
      )}

      <div className={styles.ruleList}>
        {G2B_SERVICES.map((s) => (
          <div key={s.id} className={styles.ruleItem}>
            <span className={`${styles.ruleName} ${styles.tight}`}>
              <span style={{ fontWeight: 600 }}>{G2B_SERVICE_NAME[s.id] ?? s.id}</span>
              <span className={styles.sectionDesc}>{G2B_SERVICE_GIVES[s.id] ?? ''}</span>
              <span className={styles.sectionDesc}>{RFP_ADMIN.g2bPortalNo} {s.portalNo}</span>
            </span>
            <StatusPill tone={toneFromStatusKey(s.inUse ? 'done' : 'note')}>
              {s.inUse ? RFP_ADMIN.g2bInUse : RFP_ADMIN.g2bNotUsed}
            </StatusPill>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
