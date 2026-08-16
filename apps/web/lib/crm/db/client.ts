/**
 * CRM DB 접근 단일 통로 (구현명세서 2.2, CLAUDE_dacrm 절대규칙 4)
 *
 *   "DB 접근은 getCrmDb(workspaceId) 로만 한다. 전역 prisma 로 crm_ 테이블을 만지는 코드 금지"
 *
 * 여기서 export 하는 것은 getCrmDb 하나뿐이다. PrismaClient 원본은 밖으로 내보내지 않는다.
 * 밖으로 내보내는 순간 "그냥 prisma 쓰면 되는데"가 성립해 버리고, 그러면 격리는 규칙일 뿐
 * 강제가 아니게 된다.
 *
 * ⚠️ 이 DB 의 postgres 롤은 rolbypassrls = true 다(실측). 즉 RLS 는 Prisma 연결을 막지 못한다.
 *    crm_ 테이블의 워크스페이스 격리를 실제로 지키는 것은 **이 파일의 확장**이다.
 *    RLS(199)는 PostgREST 경로를 막는 두 번째 벽이다. 첫 번째 벽이 여기다.
 */

import { PrismaClient } from '@prisma/client'
import { injectWorkspaceFilter, isCrmModel } from './workspace-guard.ts'

// Next dev 는 모듈을 반복 평가한다. 매번 새 PrismaClient 를 만들면 커넥션이 누수된다.
const globalForPrisma = globalThis as unknown as { crmPrisma?: PrismaClient }

function basePrisma(): PrismaClient {
  if (!globalForPrisma.crmPrisma) {
    globalForPrisma.crmPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }
  return globalForPrisma.crmPrisma
}

/**
 * 이 워크스페이스로 못 박힌 Prisma 클라이언트를 돌려준다.
 * crm_ 모델의 모든 연산에 workspaceId 조건이 강제 주입되고,
 * 호출부가 다른 workspaceId 를 명시하면 WORKSPACE_MISMATCH 로 던진다.
 */
export function getCrmDb(workspaceId: string) {
  return basePrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isCrmModel(model)) return query(args)
          return query(injectWorkspaceFilter(args, workspaceId, operation, model) as typeof args)
        },
      },
    },
  })
}

export type CrmDb = ReturnType<typeof getCrmDb>
