import AiPromptsClient from './AiPromptsClient'

export const metadata = { title: 'AI 프롬프트 운영' }

// 관리자 전용(admin/layout.tsx가 비관리자 리다이렉트). 축6/7.
export default function AiPromptsPage() {
  return <AiPromptsClient />
}
