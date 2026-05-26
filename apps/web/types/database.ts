export interface Profile {
  id: string
  name: string
  role: 'admin' | 'member'
  must_change_password: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface WeeklyReport {
  id: string
  user_id: string
  week_start: string
  category: string
  performance: string
  plan: string
  issues: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface KpiEntry {
  id: string
  user_id: string
  metric_name: string
  value: number
  unit: string
  period_start: string
  period_end: string
  kpi_template_label: string | null
  created_at: string
  updated_at: string
}

export interface RoutineCheck {
  id: string
  user_id: string
  routine_name: string
  check_date: string
  week_start: string
  is_completed: boolean
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  user_id: string
  name: string
  industry: string | null
  segment: '엔터프라이즈' | 'SMB' | '공공' | '스타트업' | null
  size: string | null
  region: string | null
  website: string | null
  phone: string | null
  address: string | null
  description: string | null
  fit_score: number | null
  tags: string[]
  source: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  account_id: string | null
  user_id: string
  name: string
  title: string | null
  department: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  linkedin: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type DealStage = '신규' | '검증' | '컨택' | 'PoC' | '제안' | '협상' | '수주' | '실패'

export interface Deal {
  id: string
  account_id: string | null
  contact_id: string | null
  user_id: string
  title: string
  stage: DealStage
  value: number | null
  probability: number
  close_date: string | null
  description: string | null
  next_action: string | null
  next_action_date: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'ai'

export interface DealActivity {
  id: string
  deal_id: string
  user_id: string
  type: ActivityType
  content: string
  ai_parsed: boolean
  created_at: string
}

export type LeadSource = 'prompt' | 'business_card' | 'file' | 'manual'
export type LeadStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface LeadIntake {
  id: string
  user_id: string
  source: LeadSource
  raw_input: string | null
  file_url: string | null
  status: LeadStatus
  parsed_data: Json | null
  linked_account_id: string | null
  linked_contact_id: string | null
  linked_deal_id: string | null
  fit_score: number | null
  duplicate_of: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface OrgContent {
  key: string
  value: Json
  created_at: string
  updated_at: string
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>
        Relationships: []
      }
      weekly_reports: {
        Row: WeeklyReport
        Insert: Omit<WeeklyReport, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<WeeklyReport, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'weekly_reports_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      kpi_entries: {
        Row: KpiEntry
        Insert: Omit<KpiEntry, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<KpiEntry, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'kpi_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      routine_checks: {
        Row: RoutineCheck
        Insert: Omit<RoutineCheck, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<RoutineCheck, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'routine_checks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
