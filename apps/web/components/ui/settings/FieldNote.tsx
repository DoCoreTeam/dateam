// 보조 설명 — 입력칸 아래 한 줄, 카드 부제, 수치에 병기하는 기준이 전부 이 부품에서 온다.
//
// 예전에는 같은 자리가 fs-2xs/text-faint 와 fs-2xs/text-muted 로 갈려 있었다.
// 어느 쪽이 옳은지를 화면마다 다시 정하게 두지 않는다.

import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 설명이 가리키는 입력칸의 id. 읽어 주는 기계가 둘을 잇는다 */
  id?: string
}

export default function FieldNote({ children, id }: Props) {
  return <p className="field-note" id={id}>{children}</p>
}
