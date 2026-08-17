'use client'

// 날짜 입력 SSOT — 화면이 날짜 입력을 직접 짜지 않는 유일한 이유
//
// **왜 부품이 필요한가**: 브라우저 기본 날짜 입력은 연도 칸에 자릿수 제한이 없다.
// 사용자가 날짜를 연속으로 타이핑하면 `202609`년이 **그대로 유효한 값으로 받아들여지고**,
// 그 값이 저장되면 정렬·범위필터·만료판정이 전부 어긋난다.
// (실측: 견적 유효기간 칸에서 6자리 연도가 통과했다. "브라우저 기본 동작"이라 넘긴 판이 있었지만,
//  브라우저가 막지 않는다는 것은 우리가 막아야 한다는 뜻이지 안 막아도 된다는 뜻이 아니다.)
// `min`/`max`는 브라우저 단계에서 6자리 연도를 무효로 만들고, 폼 제출도 함께 막는다.
//
// **왜 오늘이 기본값인가**: 빈 칸은 사용자를 연도부터 타이핑하게 만든다 — 위 사고가 나는 자리가 정확히 거기다.
// 오늘이 들어 있으면 대개 일/월만 고치면 되고, 연도 칸은 건드릴 일이 없다.
//
// **날짜의 '오늘'은 항상 KST다.** 기본값·상한 계산은 전부 `lib/datetime/kst.ts`(SSOT)를 거친다.
// 여기서 `new Date().toISOString().slice(0,10)`을 쓰면 오전 9시 이전에 어제가 찍힌다.

// 범위 로직은 `lib/ui/date-range.ts`에 있다 — node:test가 JSX를 못 읽어서
// 컴포넌트 안에 두면 가드가 검증할 수 없다.
import { forwardRef } from 'react'
import { DATE_MIN, dateMax, isInRange } from '@/lib/ui/date-range'

export { DATE_MIN, dateMax, isInRange, today, todayPlus } from '@/lib/ui/date-range'

type NativeProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'>

export interface DateFieldProps extends NativeProps {
  /**
   * 'YYYY-MM-DD' 또는 빈 문자열(미지정).
   * 넘기지 않으면 **비통제**로 동작한다(`defaultValue`+`name`으로 폼 제출하는 화면용).
   * 그 경우 범위 방어는 브라우저의 `min`/`max`가 맡는다 — 폼 제출이 막힌다.
   */
  value?: string
  /** 값만 받는다 — 호출처가 매번 `e.target.value`를 꺼내지 않게. */
  onValueChange?: (value: string) => void
}

/**
 * 날짜 입력. `className`을 넘겨도 `input-field`는 항상 유지된다(§2-1).
 * `min`/`max`를 안 넘기면 DATE_MIN ~ 오늘+10년으로 잠긴다.
 */
const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { value, onValueChange, className, min, max, ...rest },
  ref,
) {
  const lo = typeof min === 'string' ? min : DATE_MIN
  const hi = typeof max === 'string' ? max : dateMax()
  return (
    <input
      {...rest}
      ref={ref}
      type="date"
      className={className ? `input-field ${className}` : 'input-field'}
      {...(value === undefined ? {} : { value })}
      min={lo}
      max={hi}
      onChange={(e) => {
        const next = e.target.value
        // **빈 값에는 두 가지 뜻이 있다.** 브라우저 날짜 칸은 연·월·일이 다 차기 전에는
        // 무엇을 치고 있든 value 로 빈 문자열을 준다. 그래서 '사용자가 지웠다'와
        // '아직 치는 중이다'가 같은 값으로 도착한다.
        //
        // 이 둘을 안 가르면 연도를 이어 칠 때 중간 상태가 그대로 부모 상태에 실려
        // **이미 있던 날짜가 통째로 지워진다** — 사용자는 월·일까지 잃고 안내도 못 받는다.
        // (실측: 재현 100%. "범위 밖이면 직전 값으로 되돌아간다"는 이 경로에서 성립하지 않았다.
        //  범위검사는 빈 값을 '미지정'으로 허용하므로 애초에 걸리지 않기 때문이다.)
        //
        // 가르는 기준은 badInput 이다 — 칸에 해석 불가능한 입력이 남아 있으면 true.
        // 지운 칸은 비어 있을 뿐 잘못된 입력이 아니므로 false 다.
        if (next === '' && e.target.validity.badInput) return
        // 범위 밖이면 상태를 바꾸지 않는다 → 통제 컴포넌트라 칸이 직전 값으로 되돌아간다.
        if (!isInRange(next, lo, hi)) return
        onValueChange?.(next)
      }}
    />
  )
})

export default DateField
