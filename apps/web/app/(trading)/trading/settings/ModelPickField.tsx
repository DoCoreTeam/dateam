'use client'

// 공급자와 모델 고르기 — **앱의 공용 모달 한 벌을 쓴다**
//
// 사용자 지적 2026-09-27: 「gemini로 박지 말라고 우리 AI 키 들어 간거 다 쓸수 있도록
// 공용방식이어야지 모달로 프로바이더랑 모델 선택하게」
// 사용자 지적 2026-09-28: 「디자인이 안되어 있다니깐 모달이랑 버튼 배치랑 글자 크기도
// 저기만 유독 이상하네」 — 자작 모달을 세워 두고 있었다. 연동 카드가 쓰는 부품으로 바꾼다.
//
// 왜 쌍인가: 모델만 바꾸고 공급자가 그대로면 그 공급자에 없는 모델을 가리키게 된다.
// 화면에는 이름이 멀쩡히 적혀 있는데 판단은 한 건도 안 남는다. 둘은 같이 바뀐다.
//
// 탭에는 **키가 등록된 공급자만** 세운다. 없는 키를 고르면 그 자리는 영영 안 돈다.
// 새로고침은 안 넘긴다 — 목록은 관리자 연동 카드가 채우고 이 화면은 읽기만 한다.

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Cpu } from 'lucide-react'
import ModelPickerModal from '@/components/ui/ModelPickerModal'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import type { AiChatProviderId } from '@/types/database'
import { JUDGE_PROVIDERS } from '@/lib/trading/settings/registry'
import {
  tabsFor, MODEL_PICK, MODEL_NOT_PICKED, NO_KEY_WHY, NO_KEY_HOW,
} from '@/lib/trading/settings/model-pick'
import { ACTION } from '@/lib/terms'
import { listJudgeModels, savePickedModel } from './actions'
import styles from './ModelPickField.module.css'

interface Props {
  /** 공급자 설정 키. 모델과 함께 저장된다 */
  providerKey: string
  /** 모델 설정 키 */
  modelKey: string
  /** 지금 공급자 */
  provider: string
  /** 지금 모델 */
  current: string
  disabled: boolean
  onSaved: (provider: string, model: string) => void
}

export default function ModelPickField({
  providerKey, modelKey, provider, current, disabled, onSaved,
}: Props) {
  const [open, setOpen] = useState(false)
  const [withKey, setWithKey] = useState<string[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /**
   * 모달이 목록을 읽을 때 쓰는 손잡이. **관문이 이 화면 쪽에 남는다** —
   * 부품이 관리자 서버 액션을 직접 부르면 소유자가 관리자가 아닌 날 통째로 막힌다.
   */
  const load = useCallback(async () => {
    const r = await listJudgeModels()
    setWithKey(r.withKey ?? [])
    return r
  }, [])

  // 창을 열 때만 어느 공급자에 키가 있는지 묻는다. 그려지는 것만으로 표를 훑지 않는다
  useEffect(() => {
    if (!open || withKey !== null) return
    void load()
  }, [open, withKey, load])

  const tabs = tabsFor([...JUDGE_PROVIDERS], withKey ?? [])
  const noKey = withKey !== null && tabs.length === 0

  function handleSelect(picked: AiChatProviderId, model: string) {
    start(async () => {
      // **둘을 같이 저장한다.** 한쪽만 바뀌면 없는 모델을 가리킨다
      const r = await savePickedModel(providerKey, modelKey, picked, model)
      setMessage(r.userMessage)
      if (r.ok) onSaved(picked, model)
    })
  }

  return (
    <div className={styles.field}>
      <span className={styles.current}>
        {current ? `${provider} · ${current}` : MODEL_NOT_PICKED}
      </span>
      <button
        type="button"
        className="btn-ghost"
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        <Cpu size={14} /> {current ? ACTION.change : MODEL_PICK}
      </button>
      {message && <span role="status" className={styles.muted}>{message}</span>}

      {/* 키가 하나도 없으면 고를 것이 없다 — 창을 열어 빈 목록을 보여 주는 대신 할 일을 적는다 */}
      {open && noKey && (
        <span role="status" className={styles.blocked}>
          {`${NO_KEY_WHY} · ${NO_KEY_HOW}`}
        </span>
      )}

      {open && !noKey && (
        <ModelPickerModal
          providers={tabs.map((id) => ({
            id: id as AiChatProviderId,
            label: PROVIDER_LABELS[id as AiChatProviderId],
          }))}
          currentProvider={provider as AiChatProviderId}
          currentModel={current || null}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          load={load}
        />
      )}
    </div>
  )
}
