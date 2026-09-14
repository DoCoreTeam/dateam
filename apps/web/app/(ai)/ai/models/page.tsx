import { requireAdmin } from '@/lib/auth/requireAdmin'
import { Cpu } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { loadAiProviders } from '../load'
import ModelsClient from './ModelsClient'
import { AI_PROVIDERS } from '@/lib/ai/provider-catalog'

// 모델 — 어떤 모델을 쓸 수 있고 지금 무엇이 막혀 있는가.
//
// 예전에는 이 목록이 **대화 화면의 모달 안에만** 있었다. 그래서 "지금 Gemini 가 막혔나"를
// 보려면 대화를 하나 열고 모델 고르기를 눌러야 했다. 폴백이 알아서 갈아타게 된 지금은 더 그렇다.
// 무엇으로 답했는지 확인할 자리가 대화 밖에 있어야 한다(lib/ai-chat/model-chain).
export default async function AiModelsPage() {
  await requireAdmin()
  const { providers, defaultProvider } = await loadAiProviders()

  // 읽기 전용 뷰라 다섯을 전부 보여 준다 — 키가 없는 공급자도 자리에 두고 왜 비어 있는지 말한다.
  // 키 있는 것만 그리면 「Grok 은 어디 갔지」를 화면 밖에서 알아내야 한다.
  // (대화 화면의 공급자 고르기는 여전히 키 있는 것만 받는다 — 고를 수 없는 것을 내놓지 않는다)
  const connected = new Map(providers.map((p) => [p.id, p]))
  const allProviders = AI_PROVIDERS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    model: connected.get(spec.id)?.model ?? null,
    hasKey: connected.has(spec.id),
    purpose: spec.purpose,
  }))

  return (
    <div>
      <PageHeader
        title="모델"
        icon={<Cpu size={22} color="var(--brand)" />}
        description="공급자별 모델 목록입니다. 고른 모델이 막히면 폴백 순서대로 자동으로 갈아탑니다."
      />
      <div style={{ marginTop: 'var(--space-4)' }}>
        <ModelsClient providers={allProviders} defaultProvider={defaultProvider} />
      </div>
    </div>
  )
}
