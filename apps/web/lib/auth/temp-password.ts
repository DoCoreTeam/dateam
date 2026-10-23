import { randomInt } from 'node:crypto'

/**
 * 비밀번호 초기화와 계정 초대에 쓰는 임시 비밀번호
 *
 * **왜**: 예전에는 초기화한 계정 전부가 코드에 적힌 **같은 비밀번호** 하나를 썼고,
 *   로그인 화면은 비밀번호 칸을 비우면 그 값으로 대신 로그인했다(감사 2026-10-23).
 *   이메일만 알면 초기화 상태 계정에 들어갈 수 있었다. 이제 매번 새로 뽑고 관리자에게 한 번만 보여 준다.
 *
 * 헷갈리는 글자(0 O 1 l I)는 뺀다, 관리자가 말로 불러 주거나 손으로 옮겨 적는 값이다.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const GROUPS = 4
const GROUP_SIZE = 4

export function generateTempPassword(): string {
  const groups: string[] = []
  for (let g = 0; g < GROUPS; g++) {
    let part = ''
    for (let i = 0; i < GROUP_SIZE; i++) part += ALPHABET[randomInt(ALPHABET.length)]
    groups.push(part)
  }
  return groups.join('-')
}

/** 글자 수와 글자 집합, 시험이 세기를 확인할 때 쓴다 */
export const TEMP_PASSWORD_SHAPE = { alphabet: ALPHABET, groups: GROUPS, groupSize: GROUP_SIZE }
