'use client'

/**
 * 금액 입력 (SSOT)
 *
 * **왜 부품인가**: 금액 칸은 지금 7곳에 있고 저마다 `inputMode="numeric"` 에
 * `replace(/[^\d]/g, '')` 를 붙여 놨다. 그래서 **어디에도 천단위가 안 보인다** —
 * 「300000000」을 넣고 그게 3억인지 30억인지 세어 보게 만든다.
 * (사용자 지적, 반복: 「이런곳에 금액 넣는곳은 다 1000의 자리수 표시 하라니깐」)
 *
 * **보이는 값과 저장되는 값을 나눈다.** 화면에는 `300,000,000`, 호출부에는 `300000000`.
 * 화면이 쉼표를 지우게 두면 그 로직이 또 7벌이 되고, 한 곳에서 빠뜨리면
 * 저장할 때 쉼표가 섞여 들어가 금액이 통째로 틀어진다.
 *
 * **커서가 튀지 않게 한다.** 값이 바뀔 때마다 다시 포맷하면 커서가 끝으로 날아가는데,
 * 그러면 가운데 숫자를 고칠 수가 없다. 쉼표를 뺀 «앞쪽 숫자 개수»를 세어 그 자리로 되돌린다.
 */

import { forwardRef, useCallback, useRef, type InputHTMLAttributes } from 'react'
import { digitsOnly, groupDigits } from '@/lib/ui/money-format'

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>

export interface MoneyFieldProps extends NativeProps {
  /** 숫자만 담긴 문자열. 빈 문자열은 «아직 안 정함» */
  value: string
  /** 쉼표를 뺀 숫자만 돌려준다 — 호출부가 다시 지우지 않게 */
  onValueChange: (digits: string) => void
  /** 소수를 받을지. 기본은 정수(원화) */
  allowDecimal?: boolean
}

const MoneyField = forwardRef<HTMLInputElement, MoneyFieldProps>(function MoneyField(
  { value, onValueChange, allowDecimal = false, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement | null>(null)

  const handle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target
    const before = el.value.slice(0, el.selectionStart ?? 0)
    // 커서 앞에 **숫자가 몇 개** 있었는지 — 쉼표 위치가 바뀌어도 이 개수는 안 변한다
    const digitsBeforeCursor = (before.match(/[\d.]/g) ?? []).length

    const digits = digitsOnly(el.value, allowDecimal)
    onValueChange(digits)

    // 포맷 후 같은 «숫자 개수» 자리로 커서를 되돌린다
    const formatted = groupDigits(digits)
    let pos = 0
    let seen = 0
    while (pos < formatted.length && seen < digitsBeforeCursor) {
      if (/[\d.]/.test(formatted[pos])) seen += 1
      pos += 1
    }
    requestAnimationFrame(() => {
      const node = inner.current
      if (node && node.value === formatted) node.setSelectionRange(pos, pos)
    })
  }, [allowDecimal, onValueChange])

  return (
    <input
      ref={(node) => {
        inner.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      // `type="number"` 를 쓰지 않는다 — 쉼표를 넣는 순간 값이 통째로 빈 문자열이 된다
      type="text"
      inputMode="numeric"
      className={className ? `input-field ${className}` : 'input-field'}
      value={groupDigits(value)}
      onChange={handle}
      {...rest}
    />
  )
})

export default MoneyField
