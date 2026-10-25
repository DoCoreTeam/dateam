// 공통 기능 정의, 동작 하나에 한 줄 (형식은 ../types.ts)
// 범위와 CLI 이름은 손으로 고쳐도 됨, scaffold 는 없는 줄만 더하고 있는 줄은 안 건드림
import type { ActionDef } from '../types.ts'

export const META_DEFS: ActionDef[] = [
  { op: "GET /api/public/v1/openapi.json", name: "meta.openapi.get", scope: "read", cli: "sync", summary: "CLI 명령 표의 원본 (teamda sync 가 받음)" },
  { op: "GET /api/public/v1/me", name: "meta.me.get", scope: "read", cli: "me", summary: "이 키의 주인 역할 범위" },
  { op: "GET /api/public/v1/approvals/{id}", name: "meta.approval.get", scope: "read", cli: "approval get", summary: "승인 요청의 상태와 결과" },
  { op: "POST /api/public/v1/approvals/{id}/cancel", name: "meta.approval.cancel", scope: "read", cli: "approval cancel", summary: "내 키가 낸 승인 요청을 취소, 기다리는 중인 것만" },
  { op: "GET /api/cli/release", name: "meta.cli.release.get", scope: "read", cli: "release", summary: "지금 내려줄 teamda 판과 운영체제별 받기 주소 (600초)" },
  { op: "action app/(member)/approvals/[id]/actions.ts#decideApprovalAction", name: "meta.approval.decide", scope: "approve", cli: "approval decide", summary: "승인 요청을 승인하거나 거절" },
]
