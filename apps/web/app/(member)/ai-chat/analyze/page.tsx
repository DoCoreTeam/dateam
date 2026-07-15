import { requireAdmin } from '@/lib/auth/requireAdmin'
import AnalyzeClient from './AnalyzeClient'

// 목록 심층분석 — admin 전용 게이트(§③ 동일 정책, /ai-chat 하위 서브라우트).
export default async function AiChatAnalyzePage() {
  await requireAdmin()
  return <AnalyzeClient />
}
