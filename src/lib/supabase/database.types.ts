export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	graphql_public: {
		Tables: {
			[_ in never]: never;
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			graphql: {
				Args: {
					extensions?: Json;
					operationName?: string;
					query?: string;
					variables?: Json;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	public: {
		Tables: {
			app_settings: {
				Row: {
					description: string | null;
					key: string;
					updated_at: string;
					value: Json;
				};
				Insert: {
					description?: string | null;
					key: string;
					updated_at?: string;
					value: Json;
				};
				Update: {
					description?: string | null;
					key?: string;
					updated_at?: string;
					value?: Json;
				};
				Relationships: [];
			};
			attendance_records: {
				Row: {
					class_id: string;
					id: string;
					notes: string | null;
					present: boolean;
					recorded_at: string;
					recorded_by: string | null;
					session_date: string;
					student_id: string;
				};
				Insert: {
					class_id: string;
					id?: string;
					notes?: string | null;
					present: boolean;
					recorded_at?: string;
					recorded_by?: string | null;
					session_date?: string;
					student_id: string;
				};
				Update: {
					class_id?: string;
					id?: string;
					notes?: string | null;
					present?: boolean;
					recorded_at?: string;
					recorded_by?: string | null;
					session_date?: string;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'attendance_records_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'attendance_records_recorded_by_fkey';
						columns: ['recorded_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'attendance_records_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			class_teachers: {
				Row: {
					assigned_at: string;
					class_id: string;
					teacher_id: string;
				};
				Insert: {
					assigned_at?: string;
					class_id: string;
					teacher_id: string;
				};
				Update: {
					assigned_at?: string;
					class_id?: string;
					teacher_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_teachers_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_teachers_teacher_id_fkey';
						columns: ['teacher_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			classes: {
				Row: {
					code: string;
					created_at: string;
					created_by: string | null;
					id: string;
					name: string;
				};
				Insert: {
					code: string;
					created_at?: string;
					created_by?: string | null;
					id?: string;
					name: string;
				};
				Update: {
					code?: string;
					created_at?: string;
					created_by?: string | null;
					id?: string;
					name?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'classes_created_by_fkey';
						columns: ['created_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			homework_assignments: {
				Row: {
					class_id: string;
					created_at: string;
					created_by: string | null;
					due_offset_days: number | null;
					ends_on: string | null;
					id: string;
					paused_at: string | null;
					recurrence_rule: unknown | null;
					recurrence_start_date: string | null;
					reference_link: string | null;
					skill_area: Database['public']['Enums']['skill_area'];
					title: string;
				};
				Insert: {
					class_id: string;
					created_at?: string;
					created_by?: string | null;
					due_offset_days?: number | null;
					ends_on?: string | null;
					id?: string;
					paused_at?: string | null;
					recurrence_rule?: unknown | null;
					recurrence_start_date?: string | null;
					reference_link?: string | null;
					skill_area: Database['public']['Enums']['skill_area'];
					title: string;
				};
				Update: {
					class_id?: string;
					created_at?: string;
					created_by?: string | null;
					due_offset_days?: number | null;
					ends_on?: string | null;
					id?: string;
					paused_at?: string | null;
					recurrence_rule?: unknown | null;
					recurrence_start_date?: string | null;
					reference_link?: string | null;
					skill_area?: Database['public']['Enums']['skill_area'];
					title?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'homework_assignments_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'homework_assignments_created_by_fkey';
						columns: ['created_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			homework_instances: {
				Row: {
					archived_at: string | null;
					archived_by: string | null;
					assignment_id: string;
					class_id: string;
					created_at: string;
					due_date: string;
					id: string;
					period_start: string;
				};
				Insert: {
					archived_at?: string | null;
					archived_by?: string | null;
					assignment_id: string;
					class_id: string;
					created_at?: string;
					due_date: string;
					id?: string;
					period_start: string;
				};
				Update: {
					archived_at?: string | null;
					archived_by?: string | null;
					assignment_id?: string;
					class_id?: string;
					created_at?: string;
					due_date?: string;
					id?: string;
					period_start?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'homework_instances_archived_by_fkey';
						columns: ['archived_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'homework_instances_assignment_id_fkey';
						columns: ['assignment_id'];
						isOneToOne: false;
						referencedRelation: 'homework_assignments';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'homework_instances_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					}
				];
			};
			homework_status_history: {
				Row: {
					class_id: string;
					id: string;
					instance_id: string;
					recorded_at: string;
					recorded_by: string | null;
					status: HomeworkStatusValue;
					student_id: string;
				};
				Insert: {
					class_id: string;
					id?: string;
					instance_id: string;
					recorded_at?: string;
					recorded_by?: string | null;
					status: HomeworkStatusValue;
					student_id: string;
				};
				Update: {
					class_id?: string;
					id?: string;
					instance_id?: string;
					recorded_at?: string;
					recorded_by?: string | null;
					status?: HomeworkStatusValue;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'homework_status_history_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'homework_status_history_instance_id_fkey';
						columns: ['instance_id'];
						isOneToOne: false;
						referencedRelation: 'homework_instances';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'homework_status_history_recorded_by_fkey';
						columns: ['recorded_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'homework_status_history_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			profiles: {
				Row: {
					class_id: string | null;
					created_at: string;
					display_name: string | null;
					email: string;
					email_confirmed_at: string | null;
					guardian_consent_given_at: string | null;
					guardian_email: string | null;
					id: string;
					registration_name: string | null;
					reviewed_at: string | null;
					reviewed_by: string | null;
					role: Database['public']['Enums']['user_role'];
					status: Database['public']['Enums']['registration_status'] | null;
					team_id: string | null;
				};
				Insert: {
					class_id?: string | null;
					created_at?: string;
					display_name?: string | null;
					email: string;
					email_confirmed_at?: string | null;
					guardian_consent_given_at?: string | null;
					guardian_email?: string | null;
					id: string;
					registration_name?: string | null;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					role?: Database['public']['Enums']['user_role'];
					status?: Database['public']['Enums']['registration_status'] | null;
					team_id?: string | null;
				};
				Update: {
					class_id?: string | null;
					created_at?: string;
					display_name?: string | null;
					email?: string;
					email_confirmed_at?: string | null;
					guardian_consent_given_at?: string | null;
					guardian_email?: string | null;
					id?: string;
					registration_name?: string | null;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					role?: Database['public']['Enums']['user_role'];
					status?: Database['public']['Enums']['registration_status'] | null;
					team_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'profiles_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'profiles_reviewed_by_fkey';
						columns: ['reviewed_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'profiles_team_id_fkey';
						columns: ['team_id'];
						isOneToOne: false;
						referencedRelation: 'teams';
						referencedColumns: ['id'];
					}
				];
			};
			skill_status_history: {
				Row: {
					class_id: string;
					id: string;
					level: Database['public']['Enums']['skill_level'];
					notes: string | null;
					recorded_at: string;
					recorded_by: string | null;
					skill_area: Database['public']['Enums']['skill_area'];
					student_id: string;
				};
				Insert: {
					class_id: string;
					id?: string;
					level: Database['public']['Enums']['skill_level'];
					notes?: string | null;
					recorded_at?: string;
					recorded_by?: string | null;
					skill_area: Database['public']['Enums']['skill_area'];
					student_id: string;
				};
				Update: {
					class_id?: string;
					id?: string;
					level?: Database['public']['Enums']['skill_level'];
					notes?: string | null;
					recorded_at?: string;
					recorded_by?: string | null;
					skill_area?: Database['public']['Enums']['skill_area'];
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'skill_status_history_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'skill_status_history_recorded_by_fkey';
						columns: ['recorded_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'skill_status_history_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			teams: {
				Row: {
					created_at: string;
					id: string;
					name: string;
				};
				Insert: {
					created_at?: string;
					id?: string;
					name: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					name?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			check_registration_available: {
				Args: { p_class_id: string; p_registration_name: string };
				Returns: boolean;
			};
			generate_recurring_homework_instances: { Args: never; Returns: number };
			is_admin: { Args: never; Returns: boolean };
			is_targeted_for_homework_assignment: {
				Args: { target_assignment_id: string };
				Returns: boolean;
			};
			is_targeted_for_homework_instance: {
				Args: { target_instance_id: string };
				Returns: boolean;
			};
			is_teacher_of_class: {
				Args: { target_class_id: string };
				Returns: boolean;
			};
			validate_class_code: {
				Args: { p_code: string };
				Returns: {
					id: string;
					name: string;
				}[];
			};
		};
		Enums: {
			registration_status: 'pending' | 'approved' | 'rejected';
			skill_area: 'language' | 'song' | 'dance';
			skill_level: 'not_started' | 'learning' | 'confident';
			user_role: 'admin' | 'teacher' | 'student';
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends (DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
		: never) = never
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
	TableName extends (DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never) = never
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
	TableName extends (DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never) = never
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
	EnumName extends (DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
		: never) = never
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
		? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
		: never) = never
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
		? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	graphql_public: {
		Enums: {}
	},
	public: {
		Enums: {
			registration_status: ['pending', 'approved', 'rejected'],
			skill_area: ['language', 'song', 'dance'],
			skill_level: ['not_started', 'learning', 'confident'],
			user_role: ['admin', 'teacher', 'student']
		}
	}
} as const;

export type UserRole = Database['public']['Enums']['user_role'];
export type RegistrationStatus = Database['public']['Enums']['registration_status'];
export type SkillArea = Database['public']['Enums']['skill_area'];
export type SkillLevel = Database['public']['Enums']['skill_level'];
export type HomeworkStatusValue = 'assigned' | 'done' | 'reviewed';
