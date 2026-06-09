'use client'

import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

// 공용 폼 입력 (SSOT) — label.label + input.input-field 표준(CLAUDE.md §2-1).
// raw 태그/클래스 누락 방지: 항상 input-field·label 클래스 적용 → 테마 토큰 자동 대응.

interface FieldWrapProps {
  label?: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
}

/** label + 입력 + hint/error 묶음 래퍼 */
export function NbField({ label, htmlFor, hint, error, required, children }: FieldWrapProps) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}{required && ' *'}
        </label>
      )}
      {children}
      {hint && !error && <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{hint}</p>}
      {error && <p role="alert" style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement>
export function NbInput({ className, ...props }: InputProps) {
  return <input className={`input-field${className ? ' ' + className : ''}`} {...props} />
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>
export function NbSelect({ className, style, ...props }: SelectProps) {
  return <select className={`input-field${className ? ' ' + className : ''}`} style={{ minHeight: 44, ...style }} {...props} />
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>
export function NbTextarea({ className, ...props }: TextareaProps) {
  return <textarea className={`input-field${className ? ' ' + className : ''}`} {...props} />
}
