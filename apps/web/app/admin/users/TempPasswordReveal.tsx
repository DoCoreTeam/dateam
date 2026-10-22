'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'

interface Props {
  password: string
}

/**
 * 임시 비밀번호를 관리자에게 한 번만 보여 준다.
 *
 * 서버는 원문을 저장하지 않으므로 이 자리를 벗어나면 다시 볼 길이 없다.
 * 그 사실을 같은 자리에 적어 두어야 관리자가 옮겨 적기 전에 화면을 닫지 않는다.
 */
export default function TempPasswordReveal({ password }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <code
          aria-label="임시 비밀번호"
          style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--fs-sm)', fontWeight: 600, userSelect: 'all' }}
        >
          {password}
        </code>
        <NbButton type="button" variant="secondary" onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '복사됨' : '복사'}
        </NbButton>
      </span>
      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', wordBreak: 'keep-all' }}>
        지금만 보입니다. 본인에게 전달하면 첫 로그인 뒤 새 비밀번호로 바꾸게 됩니다
      </span>
    </span>
  )
}
