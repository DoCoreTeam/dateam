// 공통 기능 정의, 동작 하나에 한 줄 (형식은 ../types.ts)
// 범위와 CLI 이름은 손으로 고쳐도 됨, scaffold 는 없는 줄만 더하고 있는 줄은 안 건드림
import type { ActionDef } from '../types.ts'

export const META_DEFS: ActionDef[] = [
  { op: "GET /api/public/v1/openapi.json", name: "meta.openapi.get", scope: "read", cli: "sync", summary: "CLI 명령 표의 원본 (teamda sync 가 받음)" },
]
