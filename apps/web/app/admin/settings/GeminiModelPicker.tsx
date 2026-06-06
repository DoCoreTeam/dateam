'use client'

import { useState, useTransition, useEffect } from 'react'
import { CheckCircle, XCircle, RefreshCw, Cpu } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { getGeminiModels, saveGeminiModel } from './actions'

interface GeminiModelPickerProps {
  hasKey: boolean
  savedModel: string | null
}

export default function GeminiModelPicker({ hasKey, savedModel: initialModel }: GeminiModelPickerProps) {
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(initialModel ?? '')
  const [currentSavedModel, setCurrentSavedModel] = useState<string | null>(initialModel)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelMsg, setModelMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [modelsPending, startModels] = useTransition()
  const [modelSavePending, startModelSave] = useTransition()

  useEffect(() => {
    if (!hasKey) {
      setModels([])
      setModelsLoaded(false)
      setModelMsg(null)
    }
  }, [hasKey])

  function handleLoadModels() {
    setModelMsg(null)
    startModels(async () => {
      const result = await getGeminiModels()
      if (result.ok && result.models) {
        setModels(result.models)
        setModelsLoaded(true)
        const current = selectedModel
        if (result.models.length > 0 && (!current || !result.models.includes(current))) {
          setSelectedModel(result.models[0])
        }
      } else {
        setModelMsg({ ok: false, text: result.error ?? '모델 목록 조회 실패' })
      }
    })
  }

  function handleSaveModel() {
    setModelMsg(null)
    startModelSave(async () => {
      const result = await saveGeminiModel(selectedModel)
      if (result.ok) {
        setCurrentSavedModel(selectedModel)
        setModelMsg({ ok: true, text: `모델이 저장되었습니다: ${selectedModel}` })
      } else {
        setModelMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  return (
    <div style={{ borderTop: '2px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Cpu size={14} color="var(--brand)" />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>모델 선택</span>
          {currentSavedModel && !modelsLoaded && (
            <span style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
              (현재: {currentSavedModel})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleLoadModels}
          disabled={!hasKey || modelsPending}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0.5rem 0.875rem',
            backgroundColor: hasKey ? '#f1f5f9' : 'var(--color-border)',
            color: hasKey ? '#374151' : '#94a3b8',
            border: '2px solid var(--border-color)',
            borderRadius: 'var(--radius)',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: hasKey ? 'pointer' : 'not-allowed',
          }}
        >
          {modelsPending ? <AXDotLoader size={4} color="#fff" /> : <RefreshCw size={13} />}
          모델 목록 불러오기
        </button>
      </div>

      {!modelsLoaded && !modelMsg && (
        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>
          {hasKey ? '버튼을 눌러 사용 가능한 모델 목록을 불러오세요' : 'API 키를 먼저 저장해주세요'}
        </p>
      )}

      {modelsLoaded && models.length === 0 && (
        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>
          generateContent를 지원하는 모델이 없습니다
        </p>
      )}

      {modelsLoaded && models.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="input-field"
            style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.8125rem' }}
          >
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSaveModel}
            disabled={modelSavePending || !selectedModel}
            className="btn-primary"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            {modelSavePending ? <AXDotLoader size={4} color="#fff" /> : null}
            적용
          </button>
        </div>
      )}

      {modelMsg && (
        <div
          role="status"
          style={{
            marginTop: '0.625rem',
            padding: '0.625rem 0.875rem',
            borderRadius: 'var(--radius)',
            fontSize: '0.8125rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: modelMsg.ok ? '#f0fdf4' : '#fef2f2',
            color: modelMsg.ok ? '#15803d' : '#b91c1c',
            border: `1px solid ${modelMsg.ok ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {modelMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {modelMsg.text}
        </div>
      )}
    </div>
  )
}
