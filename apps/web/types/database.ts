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
