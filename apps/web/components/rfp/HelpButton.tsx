'use client'

// 물음표 — 지금 보고 있는 화면의 사용법을 연다.
//
// 물음표에 서비스 전체 문서를 붙이면 사람은 두 번째부터 안 누른다.
// 그래서 주소로 골라 그 화면에서 할 일을 먼저 말하고, 전체 순서는 그 아래 둔다.

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { HelpCircle } from 'lucide-react'
import SlidePanel from '@/components/ui/SlidePanel'
import NbButton from '@/components/ui/nb/NbButton'
import { guideFor, GUIDE_FLOW } from '@/lib/rfp/guide'
import { RFP_HELP } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

export default function HelpButton() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname() ?? '/rfp'
  const guide = guideFor(pathname)

  return (
    <>
      <NbButton variant="secondary" onClick={() => setOpen(true)} aria-label={RFP_HELP.open} title={RFP_HELP.open}>
        <HelpCircle size={16} />{RFP_HELP.short}
      </NbButton>

      <SlidePanel
        isOpen={open}
        onClose={() => setOpen(false)}
        title={RFP_HELP.title}
        icon={<HelpCircle size={18} />}
      >
        <div className={styles.stack}>
          <section>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>{guide.title}</span>
              <span className={styles.sectionDesc}>{guide.lead}</span>
            </div>
            <dl className={styles.inner}>
              {guide.steps.map((s) => (
                <div key={s.title} className={styles.tight}>
                  <dt className="label">{s.title}</dt>
                  <dd className={styles.sectionDesc} style={{ margin: 0 }}>{s.body}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>{RFP_HELP.flowTitle}</span>
              <span className={styles.sectionDesc}>{RFP_HELP.flowLead}</span>
            </div>
            <dl className={styles.inner}>
              {GUIDE_FLOW.map((s) => (
                <div key={s.title} className={styles.tight}>
                  <dt className="label">{s.title}</dt>
                  <dd className={styles.sectionDesc} style={{ margin: 0 }}>{s.body}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </SlidePanel>
    </>
  )
}
