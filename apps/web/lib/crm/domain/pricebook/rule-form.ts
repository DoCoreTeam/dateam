/**
 * 규칙 편집 창이 처음 띄울 값, 화면 상태를 여기서 정해 시험으로 잠근다
 *
 * 실측 2026-10-23(REQ-021): 「고를 수 있는 조건」 창이 워크스테이션·데스크톱·NPU 를 **체크한 채로** 열렸다.
 * 사람은 워크스테이션·데스크톱을 고르려고 눌렀고, 누를 때마다 해제돼 NPU 만 저장됐다.
 * 새 규칙은 빈 선택으로 열고, 고칠 때만 저장된 값을 채운다.
 */

import type { GpuClass } from './types.ts'

const GPU_CLASSES: readonly GpuClass[] = ['DC', 'WS', 'CONSUMER', 'NPU']

export function initialClasses(saved: unknown): GpuClass[] {
  if (!Array.isArray(saved)) return []
  return saved.filter((c): c is GpuClass => (GPU_CLASSES as readonly unknown[]).includes(c))
}

export function toggleClass(classes: readonly GpuClass[], c: GpuClass): GpuClass[] {
  return classes.includes(c) ? classes.filter((x) => x !== c) : [...classes, c]
}
