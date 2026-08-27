'use client'

// components/ui/ContactLink.tsx — 연락처 한 칸(전화·이메일)
//
// **왜 부품인가**: 같은 "연락처"가 표면마다 다르게 그려지고 있었다(§2-5) —
// 인물 목록은 평문, 인물 상세는 링크지만 링크로 안 보이고, 담당자 목록은 이메일만 링크였다.
// 그래서 전화는 **어디에서도 걸 수 없었다.**
// (사용자 지적: "모바일로 쓸 경우 바로 전화를 하거나 메일에서는 바로 메일을 보거나 할텐데")
//
// 화면마다 `<a href="tel:">` 을 기억해서 붙이는 규칙은 반드시 빠뜨린다. 여기서 강제한다.
//
// 링크가 **링크로 보여야** 한다는 것도 여기서 맡는다. Tailwind preflight 가 `a` 의 색과
// 밑줄을 지우기 때문에, 클래스를 안 주면 링크는 평문과 구분되지 않는다 — 실제로
// 인물 상세의 `mailto:` 가 그 상태였다(있는데 아무도 누를 수 있는 줄 몰랐다).

import { useCallback, useState, type ReactNode } from 'react'
import { Check, Copy, Globe, Mail, Phone } from 'lucide-react'
import { formatDomain, formatPhone, mailtoHref, siteHref, telHref } from '@/lib/contact/format'
import styles from './contact-link.module.css'

/**
 * 셋 다 "이 상대에게 닿는 길"이다. 도메인을 뺐더니 도메인만 평문으로 남았다 —
 * 종류를 늘리는 자리는 여기 하나여야 화면이 안 갈린다.
 */
type Kind = 'phone' | 'email' | 'domain'

interface Props {
  kind: Kind
  value: string | null | undefined
  /** 앞에 아이콘을 붙일지. 라벨이 이미 '전화'/'이메일'인 자리에서는 끈다 */
  icon?: boolean
  /** 복사 단추를 붙일지(기본 붙임) */
  copyable?: boolean
  /** 값이 없을 때 그릴 것. 기본은 '—' — 빈 칸은 "없음"인지 "못 불러옴"인지 구분이 안 된다 */
  fallback?: ReactNode
}

const COPIED_MS = 1500

export default function ContactLink({ kind, value, icon = true, copyable = true, fallback }: Props) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'fail'>('idle')

  const text = kind === 'phone' ? formatPhone(value)
    : kind === 'domain' ? formatDomain(value)
    : (value ?? '').trim()
  const href = kind === 'phone' ? telHref(value)
    : kind === 'domain' ? siteHref(value)
    : mailtoHref(value)

  const copy = useCallback(async () => {
    try {
      // 눈에 보이는 그대로 복사한다 — 화면과 다른 값이 붙으면 사용자는 오작동으로 읽는다
      await navigator.clipboard.writeText(text)
      setCopied('done')
    } catch {
      // 클립보드는 보안 컨텍스트(https·localhost)에서만 열린다. 조용히 삼키지 않는다
      setCopied('fail')
    }
    setTimeout(() => setCopied('idle'), COPIED_MS)
  }, [text])

  if (!text) return <>{fallback ?? <span className={styles.empty}>—</span>}</>

  const Icon = kind === 'phone' ? Phone : kind === 'domain' ? Globe : Mail
  const actionLabel = kind === 'phone' ? `${text}로 전화 걸기`
    : kind === 'domain' ? `${text} 새 탭으로 열기`
    : `${text}로 메일 쓰기`

  return (
    <span className={styles.root}>
      {icon && <Icon size={13} className={styles.icon} aria-hidden="true" />}

      {href ? (
        <a
          href={href}
          className={styles.link}
          title={actionLabel}
          /* 홈페이지는 우리 화면을 떠나는 이동이라 새 탭으로 연다(작업 중이던 것을 잃지 않게) */
          target={kind === 'domain' ? '_blank' : undefined}
          rel={kind === 'domain' ? 'noopener noreferrer' : undefined}
          /* 행 전체가 상세로 이동하는 목록에서도 이 링크가 먼저다(ListSurface 가 앵커 위 클릭은 비켜선다) */
        >
          {text}
        </a>
      ) : (
        // 걸 수도 보낼 수도 없는 값이면 링크인 척하지 않는다
        <span className={styles.plain}>{text}</span>
      )}

      {copyable && (
        <button
          type="button"
          className={styles.copy}
          onClick={(e) => { e.stopPropagation(); void copy() }}
          aria-label={copied === 'done' ? '복사됨' : `${text} 복사`}
          title={copied === 'fail' ? '복사할 수 없습니다 — 직접 선택해 주세요' : '복사'}
          data-state={copied}
        >
          {copied === 'done' ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}

      {/* 복사 결과는 화면에도 남긴다 — 아이콘만 바뀌면 스크린리더 사용자는 알 길이 없다 */}
      <span role="status" aria-live="polite" className={styles.sr}>
        {copied === 'done' ? '복사했습니다' : copied === 'fail' ? '복사하지 못했습니다' : ''}
      </span>
    </span>
  )
}
