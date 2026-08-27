// components/ui/ControlRow.tsx — 「라벨 + 컨트롤이 한 줄에 선다」의 SSOT
//
// 왜 부품인가 (사용자 지적 2026-08-27):
//   「옆에 탭이든 버튼이든 있으면 세로 정렬을 중앙으로 해야 밸런스가 맞지」
//   실측 /develop 「코드 언어」 — 라벨만 탭보다 아래로 내려앉아 있었다.
//
// 원인은 정렬 속성이 아니라 **여백의 소유자**였다. `.seg-tabs` 가
// `margin-bottom: var(--space-5)` 를 자기 안에 들고 있어서, `align-items: center` 가
// 그 여백까지 포함한 마진 박스를 기준으로 가운데를 잡았다. 탭 알약은 위로,
// 라벨은 여백의 절반만큼 아래로 — 화면 6곳이 전부 같은 증상이었다.
//
// 그래서 규칙을 문서로 두지 않고 **부품으로** 만든다. 화면이 매번
// `display:flex; align-items:center` 를 손으로 적고 부품의 여백까지 기억해야 하는 규칙은
// 반드시 빠뜨린다(SegmentedTabs 가 Suspense 경계를 자기 안에 둔 것과 같은 이유).
//
//   <ControlRow label="코드 언어">
//     <SegmentedTabs … />
//   </ControlRow>
//
// 정렬을 다르게 하고 싶으면 `align` 으로 밝힌다 — 폼처럼 라벨이 컨트롤 **위에** 붙는
// 줄은 바닥 정렬이 맞다(§2-3-1 (3)). 기본값은 가운데다.

import type { ReactNode } from 'react'

export interface ControlRowProps {
  /** 왼쪽에 서는 짧은 이름. 없으면 컨트롤만 선다 */
  label?: string
  children: ReactNode
  /** 오른쪽 끝으로 밀어 둘 것(부가 버튼 등) */
  right?: ReactNode
  /**
   * 기본 `center` — 옆에 선 것들의 가운데를 맞춘다.
   * `end` 는 라벨이 컨트롤 위에 붙은 폼 줄에서만 쓴다(§2-3-1 (3)).
   */
  align?: 'center' | 'end'
  /** 줄 아래 간격을 이 줄이 갖는다. 바깥에서 이미 간격을 주면 false */
  gap?: boolean
  id?: string
}

export default function ControlRow({
  label, children, right, align = 'center', gap = true, id,
}: ControlRowProps) {
  return (
    // 클래스 이름을 여기 **글자 그대로** 둔다 — design:check 가 「공용 부품이 쓰는 클래스」를
    // className 리터럴로 판정한다. 변수로 조립하면 시스템 CSS 가 아닌 것으로 읽혀 차단된다.
    <div
      id={id}
      className={`control-row${gap ? ' control-row--gap' : ''}`}
      style={align === 'end' ? { alignItems: 'flex-end' } : undefined}
    >
      {label && <span className="control-row-label">{label}</span>}
      {children}
      {right && <span className="control-row-spacer">{right}</span>}
    </div>
  )
}
