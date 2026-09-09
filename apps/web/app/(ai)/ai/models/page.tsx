import { requireAdmin } from '@/lib/auth/requireAdmin'
import { Cpu } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { loadAiProviders } from '../load'
import ModelsClient from './ModelsClient'

// 모델 — 어떤 모델을 쓸 수 있고 지금 무엇이 막혀 있는가.
//
// 예전에는 이 목록이 **대화 화면의 모달 안에만** 있었다. 그래서 "지금 Gemini 가 막혔나"를
// 보려면 대화를 하나 열고 모델 고르기를 눌러야 했다. 폴백이 알아서 갈아타게 된 지금은 더 그렇다.
// 무엇으로 답했는지 확인할 자리가 대화 밖에 있어야 한다(lib/ai-chat/model-chain).
export default async function AiModelsPage() {
  await requireAdmin()
  const { providers, defaultProvider } = await loadAiProviders()

  return (
    <div>
      <PageHeader
        title="모델"
        icon={<Cpu size={22} color="var(--brand)" />}
        description="키가 설정된 공급자의 모델 목록입니다. 고른 모델이 막히면 이 순서대로 자동으로 갈아탑니다."
      />
      <div style={{ marginTop: 'var(--space-4)' }}>
        <ModelsClient providers={providers} defaultProvider={defaultProvider} />
      </div>
    </div>
  )
}
