/**
 * TypeScript types for the Supabase database schema.
 * Generated from migration: 20240101000001_initial_schema.sql
 * Regenerate with: supabase gen types typescript --local
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: 'owner' | 'admin' | 'staff' | 'operator';
          is_active: boolean;
          created_at: string;
          updated_at: string;
          auth_user_id: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          full_name: string;
          role: 'owner' | 'admin' | 'staff' | 'operator';
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          auth_user_id?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: 'owner' | 'admin' | 'staff' | 'operator';
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          full_name: string;
          wa_number: string;
          category: string | null;
          status: 'active' | 'inactive';
          notes: string | null;
          joined_at: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          wa_number: string;
          category?: string | null;
          status?: 'active' | 'inactive';
          notes?: string | null;
          joined_at?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          wa_number?: string;
          category?: string | null;
          status?: 'active' | 'inactive';
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contacts_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      contact_groups: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_groups_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      contact_group_members: {
        Row: {
          contact_id: string;
          group_id: string;
          added_at: string;
        };
        Insert: {
          contact_id: string;
          group_id: string;
          added_at?: string;
        };
        Update: {
          added_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_group_members_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contact_group_members_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'contact_groups';
            referencedColumns: ['id'];
          }
        ];
      };
      broadcast_jobs: {
        Row: {
          id: string;
          title: string;
          message_body: string;
          template_id: string | null;
          attachment_id: string | null;
          wa_session_id: string;
          status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
          recipient_type: 'all' | 'group' | 'manual';
          scheduled_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          last_sent_index: number;
          total_recipients: number;
          sent_count: number;
          failed_count: number;
          rate_limit_min_ms: number;
          rate_limit_max_ms: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          message_body: string;
          template_id?: string | null;
          attachment_id?: string | null;
          wa_session_id: string;
          status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
          recipient_type: 'all' | 'group' | 'manual';
          scheduled_at?: string | null;
          rate_limit_min_ms?: number;
          rate_limit_max_ms?: number;
          created_by?: string | null;
        };
        Update: {
          status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
          started_at?: string | null;
          completed_at?: string | null;
          last_sent_index?: number;
          sent_count?: number;
          failed_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'broadcast_jobs_wa_session_id_fkey';
            columns: ['wa_session_id'];
            isOneToOne: false;
            referencedRelation: 'wa_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'broadcast_jobs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      message_logs: {
        Row: {
          id: string;
          broadcast_id: string;
          contact_id: string;
          wa_number: string;
          status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
          error_code: string | null;
          error_message: string | null;
          sent_at: string | null;
          delivered_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          broadcast_id: string;
          contact_id: string;
          wa_number: string;
          status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
          error_code?: string | null;
          error_message?: string | null;
        };
        Update: {
          status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
          error_code?: string | null;
          error_message?: string | null;
          sent_at?: string | null;
          delivered_at?: string | null;
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'message_logs_broadcast_id_fkey';
            columns: ['broadcast_id'];
            isOneToOne: false;
            referencedRelation: 'broadcast_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_logs_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          }
        ];
      };
      wa_sessions: {
        Row: {
          id: string;
          session_key: string;
          phone_number: string | null;
          display_name: string | null;
          status: 'connected' | 'disconnected' | 'expired' | 'pairing';
          last_active_at: string | null;
          expires_at: string | null;
          owner_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_key: string;
          phone_number?: string | null;
          display_name?: string | null;
          status?: 'connected' | 'disconnected' | 'expired' | 'pairing';
          last_active_at?: string | null;
          expires_at?: string | null;
          owner_id?: string | null;
        };
        Update: {
          phone_number?: string | null;
          display_name?: string | null;
          status?: 'connected' | 'disconnected' | 'expired' | 'pairing';
          last_active_at?: string | null;
          expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'wa_sessions_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      message_templates: {
        Row: {
          id: string;
          title: string;
          body: string;
          attachment_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          body: string;
          attachment_id?: string | null;
          created_by?: string | null;
        };
        Update: {
          title?: string;
          body?: string;
          attachment_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'message_templates_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      keyword_rules: {
        Row: {
          id: string;
          name: string;
          response_text: string;
          is_active: boolean;
          is_greeting: boolean;
          wa_session_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          response_text: string;
          is_active?: boolean;
          is_greeting?: boolean;
          wa_session_id?: string | null;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          response_text?: string;
          is_active?: boolean;
          is_greeting?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'keyword_rules_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      activity_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          detail: Json | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          detail?: Json | null;
          ip_address?: string | null;
        };
        Update: {
          action?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      media_attachments: {
        Row: {
          id: string;
          storage_path: string;
          original_name: string;
          mime_type: string;
          file_size_bytes: number;
          caption: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          storage_path: string;
          original_name: string;
          mime_type: string;
          file_size_bytes: number;
          caption?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          storage_path?: string;
          original_name?: string;
          mime_type?: string;
          file_size_bytes?: number;
          caption?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'media_attachments_uploaded_by_fkey';
            columns: ['uploaded_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      broadcast_recipients: {
        Row: {
          id: string;
          broadcast_id: string;
          contact_id: string;
          send_order: number;
        };
        Insert: {
          id?: string;
          broadcast_id: string;
          contact_id: string;
          send_order: number;
        };
        Update: {
          send_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'broadcast_recipients_broadcast_id_fkey';
            columns: ['broadcast_id'];
            isOneToOne: false;
            referencedRelation: 'broadcast_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'broadcast_recipients_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          }
        ];
      };
      keyword_triggers: {
        Row: {
          id: string;
          rule_id: string;
          keyword: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          rule_id: string;
          keyword: string;
          created_at?: string;
        };
        Update: {
          keyword?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'keyword_triggers_rule_id_fkey';
            columns: ['rule_id'];
            isOneToOne: false;
            referencedRelation: 'keyword_rules';
            referencedColumns: ['id'];
          }
        ];
      };
      greeted_contacts: {
        Row: {
          contact_wa_number: string;
          session_id: string;
          greeted_at: string;
        };
        Insert: {
          contact_wa_number: string;
          session_id: string;
          greeted_at?: string;
        };
        Update: {
          greeted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'greeted_contacts_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'wa_sessions';
            referencedColumns: ['id'];
          }
        ];
      };
      failed_login_attempts: {
        Row: {
          email: string;
          attempt_at: string;
          ip_address: string | null;
        };
        Insert: {
          email: string;
          attempt_at?: string;
          ip_address?: string | null;
        };
        Update: {
          attempt_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
  };
};
