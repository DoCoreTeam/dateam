// Neo-brutalism 공용 버튼 — 디자인 SSOT.
// 화면마다 버튼 스타일을 인라인으로 적던 것을 이 컴포넌트로 대체(점진 도입).
// 색/보더/그림자 변경 시 이 파일 1곳만 수정하면 전 화면 반영.
'use client'

import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react'
import Link from 'next/link'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'danger-ghost'

interface NbButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /**
   * 누르면 **이동하는** 버튼. 있으면 `<a>` 로 그린다.
   *
   * **왜 필요한가**: 이동은 링크여야 새 탭·우클릭·키보드가 전부 동작한다.
   * 그런데 이 부품이 버튼만 그려서, 화면들이 `<Link className="btn-ghost">` 에
   * `display:flex; gap; textDecoration:none; padding; minHeight:44px` 를
   * **저마다 인라인으로 다시 적고 있었다**(실측 5곳, 값이 서로 달랐다 —
   * minHeight 가 36 인 곳과 44 인 곳이 공존).
   * 모양이 같아야 할 것을 화면이 기억하게 두면 반드시 갈린다(§2-5).
   */
  href?: string
  /** 외부 링크일 때 — 새 탭으로 열되 opener 를 넘기지 않는다 */
  target?: AnchorHTMLAttributes<HTMLAnchorElement>['target']
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-ghost',
  danger: 'btn-primary nb-danger',
  ghost: 'btn-ghost',
  // 목록 행의 삭제처럼 **위험하지만 주역이 아닌** 액션. 채워진 빨강은 행을 덮는다.
  'danger-ghost': 'btn-ghost nb-danger',
}

export default function NbButton({ variant = 'primary', className, href, target, ...rest }: NbButtonProps) {
  const cls = `${VARIANT_CLASS[variant]} nb-btn${className ? ' ' + className : ''}`

  if (href !== undefined) {
    // disabled 인 링크는 없다 — 못 누르게 하려면 애초에 안 그린다.
    // 여기서 흉내 내면 «회색인데 눌리는» 링크가 생긴다.
    const { disabled, type: _type, onClick: _onClick, ...anchorRest } = rest
    if (disabled) return <span className={`${cls} nb-btn-disabled`}>{rest.children}</span>
    const external = /^https?:\/\//.test(href)
    if (external || target) {
      return (
        <a
          className={cls}
          href={href}
          target={target}
          rel={target === '_blank' ? 'noreferrer' : undefined}
          {...(anchorRest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        />
      )
    }
    return <Link className={cls} href={href} {...(anchorRest as AnchorHTMLAttributes<HTMLAnchorElement>)} />
  }

  return <button className={cls} {...rest} />
}
