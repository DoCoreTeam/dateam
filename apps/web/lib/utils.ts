import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { startOfISOWeek, getISOWeek, getISOWeekYear } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getWeekStart(date: Date = new Date()): Date {
  return startOfISOWeek(date)
}

export function formatWeekLabel(date: Date): string {
  const start = startOfISOWeek(date)
  return `${getISOWeekYear(start)}년 ${getISOWeek(start)}주차`
}

export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
