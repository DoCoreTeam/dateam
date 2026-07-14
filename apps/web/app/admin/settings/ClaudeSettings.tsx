'use client'

import { useState, useTransition, useEffect } from 'react'
import { Key, CheckCircle, XCircle, RefreshCw, Cpu } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveClaudeKey, saveClaudeModel, getClaudeModels } from './actions'

const RECOMMENDED_MODEL = 'claude-opus-4-8'

interface ClaudeSettingsProps {
  hasKey: boolean
  maskedKey: string | null
  savedModel: string | null
}

export default function ClaudeSettings({ hasKey: initialHasKey, maskedKey: initialMasked, savedModel }: ClaudeSettingsProps) {
  const [hasKey, setHasKey] = useState(initialHasKey)
  const [maskedKey, setMaskedKey] = useState(initialMasked)
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(!initialHasKey)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()

  // 모델 피커
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(savedModel ?? RECOMMENDED_MODEL)
  const [currentSavedModel, setCurrentSavedModel] = useState<string | null>(savedModel)
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

  function handleSave(formData: FormData) {
    setSaveMsg(null)
    startSave(async () => {
      const result = await saveClaudeKey(formData)
      if (result.ok) {
        setSaveMsg({ ok: true, text: 'API 키가 저장되었습니다' })
        setHasKey(true)
        setInputKey('')
        setShowInput(false)
        const k = (formData.get('apiKey') as string).trim()
        setMaskedKey(k.slice(0, 7) + '••••••••' + k.slice(-4))
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  function handleLoadModels() {
    setModelMsg(null)
    startModels(async () => {
      const result = await getClaudeModels()
      if (result.ok && result.models) {
        setModels(result.models)
        setModelsLoaded(true)
        const current = selectedModel
        if (result.models.length > 0 && (!current || !result.models.includes(current))) {
          setSelectedModel(result.models.includes(RECOMMENDED_MODEL) ? RECOMMENDED_MODEL : result.models[0])
        }
      } else {
        setModelMsg({ ok: false, text: result.error ?? '모델 목록 조회 실패' })
      }
    })
  }

  function handleSaveModel() {
    setModelMsg(null)
    startModelSave(async () => {
      const result = await saveClaudeModel(selectedModel)
      if (result.ok) {
        setCurrentSavedModel(selectedModel)
        setModelMsg({ ok: true, text: `모델이 저장되었습니다: ${selectedModel}` })
      } else {
        setModelMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
        <Key size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>Claude API 키</h2>
      </div>

      {hasKey && maskedKey && (
        <div style={{ padding: '0.875rem 1rem', backgroundColor: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <CheckCircle size={14} color="var(--success)" />
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--success)' }}>API 키 설정됨</span>
            </div>
            <button
              type="button"
              onClick={() => setShowInput((v) => !v)}
              style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)' }}
            >
              변경
            </button>
          </div>
          <code style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', marginTop: '0.375rem', display: 'block', fontFamily: 'monospace' }}>
            {maskedKey}
          </code>
        </div>
      )}

      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">API 키 입력</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
            <input className="input-field"
              name="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="sk-ant-..."
              style={{ flex: 1, fontFamily: 'monospace' }}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={savePending || !inputKey.trim()}
              className="btn-primary"
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              {savePending ? <AXDotLoader size={4} color="#fff" /> : null}
              저장
            </button>
          </div>
        </form>
      )}

      {saveMsg && (
        <div
          role="status"
          style={{
            padding: '0.625rem 0.875rem',
            borderRadius: 'var(--radius)',
            marginBottom: '1rem',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: saveMsg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: saveMsg.ok ? 'var(--success)' : 'var(--danger)',
            border: `var(--hairline) solid ${saveMsg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          {saveMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {saveMsg.text}
        </div>
      )}

      {/* 모델 선택 */}
      <div style={{ borderTop: 'var(--border-w-2) solid var(--border-color)', paddingTop: 'var(--space-4)', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Cpu size={14} color="var(--brand)" />
            <span style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text)' }}>모델 선택</span>
            {currentSavedModel && !modelsLoaded && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
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
              backgroundColor: hasKey ? 'var(--surface-muted)' : 'var(--color-border)',
              color: hasKey ? 'var(--text)' : 'var(--text-faint)',
              border: 'var(--border-w-2) solid var(--border-color)',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              cursor: hasKey ? 'pointer' : 'not-allowed',
            }}
          >
            {modelsPending ? <AXDotLoader size={4} color="#fff" /> : <RefreshCw size={13} />}
            모델 목록 불러오기
          </button>
        </div>

        {!modelsLoaded && !modelMsg && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', margin: 0 }}>
            {hasKey ? `버튼을 눌러 모델 목록을 불러오세요 (권장: ${RECOMMENDED_MODEL})` : 'API 키를 먼저 저장해주세요'}
          </p>
        )}

        {modelsLoaded && models.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <select className="input-field"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 'var(--fs-sm)' }}
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
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              backgroundColor: modelMsg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
              color: modelMsg.ok ? 'var(--success)' : 'var(--danger)',
              border: `var(--hairline) solid ${modelMsg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
            }}
          >
            {modelMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {modelMsg.text}
          </div>
        )}
      </div>
    </div>
  )
}
