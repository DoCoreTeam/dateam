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
  tabsFor, pickTroubles, MODEL_PICK, MODEL_NOT_PICKED,
} from '@/lib/trading/settings/model-pick'
/**
 * **형만 들여온다.** 이 모듈을 값으로 들여오면 그 안의 `import('./key-store.ts')` 가
 * 클라이언트 묶음으로 끌려 들어가 빌드가 「server-only 를 화면에서 부른다」로 죽는다
 * (실측 2026-09-28, 설정 화면이 500 이 됐다). 문장은 창구가 실어 보낸다.
 */
import type { KeyChoice } from '@/lib/ai/provider-key-source'
import { ACTION } from '@/lib/terms'
import { listJudgeModels, savePickedModel } from './actions'
import styles from './ModelPickField.module.css'

/**
 * **진행 중인 물음 하나를 나눠 쓴다.**
 *
 * 설정 화면에는 고르는 자리가 둘(판단·지식)이고, 둘 다 마운트에서 같은 것을 묻는다.
 * 캐시가 아니라 겹침 방지다 — 끝나면 비우므로 다음 물음은 새로 나간다.
 * 브라우저 탭 하나 안의 값이라 사용자끼리 섞이지 않는다.
 */
let inflight: ReturnType<typeof listJudgeModels> | null = null

function askOnce(): ReturnType<typeof listJudgeModels> {
  if (inflight) return inflight
  inflight = listJudgeModels().finally(() => { inflight = null })
  return inflight
}

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
  const [keyState, setKeyState] = useState<Record<string, KeyChoice['reason']>>({})
  const [envBlockedText, setEnvBlockedText] = useState<string | undefined>(undefined)
  const [catalog, setCatalog] = useState<{ provider: string; modelId: string }[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /**
   * 모달이 목록을 읽을 때 쓰는 손잡이. **관문이 이 화면 쪽에 남는다** —
   * 부품이 관리자 서버 액션을 직접 부르면 소유자가 관리자가 아닌 날 통째로 막힌다.
   */
  const load = useCallback(async () => {
    const r = await askOnce()
    setWithKey(r.withKey ?? [])
    setKeyState(r.keyState ?? {})
    setEnvBlockedText(r.envBlockedMessage)
    setCatalog((r.items ?? []).map((i) => ({ provider: i.provider as string, modelId: i.modelId })))
    return r
  }, [])

  /**
   * **창을 열기 전에 묻는다.**
   *
   * 전에는 열 때만 물었다. 그래서 「jev · gemini-3.6-flash」처럼 **채워져 있는데 안 도는**
   * 상태가 화면에서 정상과 똑같이 보였고, 창을 안 열면 영영 안 보였다(실측 2026-09-28).
   * 고장을 보려고 창을 열어야 한다면 그 화면은 고장을 숨기고 있는 것이다.
   */
  useEffect(() => {
    if (withKey !== null) return
    void load()
  }, [withKey, load])

  const tabs = tabsFor([...JUDGE_PROVIDERS], withKey ?? [])
  const noKey = withKey !== null && tabs.length === 0

  /** 지금 고른 쌍이 실제로 돌 수 있나. 못 읽었으면 아무 말도 안 한다 */
  const troubles = withKey === null ? [] : pickTroubles({
    provider, model: current, withKey, catalog, keyState,
    providerName: (id) => PROVIDER_LABELS[id as AiChatProviderId] ?? id,
    // 「이 판에서는 운영 키를 안 쓴다」는 문장은 키를 고르는 자리 한 곳에만 있다
    envBlockedText,
  })

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

      {/*
        막힌 곳은 **늘 보인다.** 창을 여닫는 것과 상관없다 —
        열어야 보이는 고장은 안 보이는 고장과 같다
      */}
      {troubles.map((t) => (
        <span key={t.kind} role="status" className={styles.blocked}>
          {`${t.why} · ${t.how}`}
        </span>
      ))}

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
