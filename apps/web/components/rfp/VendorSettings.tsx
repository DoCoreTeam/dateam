'use client'

// AI 공급자 — **키는 여기서 안 받는다.**
//
// 공급자와 키는 관리자 설정에 한 벌 있고 사내 전체가 그것을 쓴다.
// RFP 가 자기 폼을 또 만들면 같은 키를 두 군데 넣게 되고,
// 한쪽만 바꿔 놓고 「왜 RFP 만 안 되지」를 겪는다.
//
// RFP 에만 있는 질문은 하나다 — **이 모델에 어느 등급까지 보내도 되나.**

import { ExternalLink } from 'lucide-react'
import NbBadge from '@/components/ui/nb/NbBadge'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import { RFP_ADMIN, DOC_CLASS_LABEL } from '@/lib/rfp/terms'
import { HOST_AI_SETTINGS_HREF } from '@/lib/rfp/ai/host-providers'
import type { DocClass } from '@/lib/rfp/domain/doc-class'
import styles from '@/app/(rfp)/rfp.module.css'

export interface VendorRow {
  id: string
  name: string
  modelName: string | null
  isInternal: boolean
  /** 호스트에 키가 들어 있나 */
  hasKey: boolean
  allowedDocClasses: DocClass[]
}

/** 등급이 높을수록 눈에 띄어야 한다 */
const CLASS_STATUS: Record<DocClass, 'note' | 'doing' | 'blocker'> = {
  public: 'note', restricted: 'doing', nda: 'blocker',
}

export default function VendorSettings({ vendors }: { vendors: VendorRow[] }) {
  return (
    <section className="card">
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{RFP_ADMIN.vendors}</span>
        <span className={styles.sectionDesc}>{RFP_ADMIN.vendorsHint}</span>
      </div>

      {vendors.length === 0 ? (
        <EmptyState
          title={RFP_ADMIN.noVendors}
          description={RFP_ADMIN.noVendorsHint}
          action={{ label: RFP_ADMIN.vendorsLink, href: HOST_AI_SETTINGS_HREF }}
        />
      ) : (
        <>
          <div className={styles.ruleList}>
            {vendors.map((v) => (
              <div key={v.id} className={styles.ruleItem}>
                <div className={`${styles.ruleName} ${styles.tight}`}>
                  <span style={{ fontWeight: 600 }}>{v.name}</span>
                  <span className={styles.sectionDesc}>
                    {v.modelName ?? RFP_ADMIN.notRegistered}
                  </span>
                </div>

                <div className={styles.row}>
                  {v.isInternal && <NbBadge status="done">{RFP_ADMIN.internalVendor}</NbBadge>}
                  {/* 이 모델에 어느 등급까지 보내도 되나 — RFP 에만 있는 질문이다 */}
                  {v.allowedDocClasses.map((c) => (
                    <NbBadge key={c} status={CLASS_STATUS[c]}>{DOC_CLASS_LABEL[c]}</NbBadge>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.actions}>
            <NbButton variant="ghost" href={HOST_AI_SETTINGS_HREF}>
              <ExternalLink size={14} /> {RFP_ADMIN.vendorsLink}
            </NbButton>
          </div>
        </>
      )}
    </section>
  )
}
