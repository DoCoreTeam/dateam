// Neo-brutalism 공용 버튼 — 디자인 SSOT.
// 화면마다 버튼 스타일을 인라인으로 적던 것을 이 컴포넌트로 대체(점진 도입).
// 색/보더/그림자 변경 시 이 파일 1곳만 수정하면 전 화면 반영.
'use client'

import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'danger-ghost'

interface NbButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-ghost',
  danger: 'btn-primary nb-danger',
  ghost: 'btn-ghost',
  // 목록 행의 삭제처럼 **위험하지만 주역이 아닌** 액션. 채워진 빨강은 행을 덮는다.
  'danger-ghost': 'btn-ghost nb-danger',
}

export default function NbButton({ variant = 'primary', className, ...rest }: NbButtonProps) {
  const cls = `${VARIANT_CLASS[variant]}${className ? ' ' + className : ''}`
  return <button className={cls} {...rest} />
}
