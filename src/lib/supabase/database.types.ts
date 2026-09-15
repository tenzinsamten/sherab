// Hand-written to match supabase/migrations/0001_init.sql and
// supabase/migrations/0002_student_registration.sql.
//
// Regenerate (and replace this file) once local Supabase is running:
//   npx supabase gen types typescript --local > src/lib/supabase/database.types.ts

export type UserRole = 'admin' | 'teacher' | 'student';
export type RegistrationStatus = 'pending' | 'approved' | 'rejected';
export type SkillArea = 'language' | 'song' | 'dance';
export type SkillLevel = 'not_started' | 'learning' | 'confident';
export type HomeworkStatusValue = 'assigned' | 'done' | 'reviewed';

export type Database = {
	public: {
		Tables: {
			profiles: {
				Row: {
					id: string;
					email: string;
					display_name: string | null;
					role: UserRole;
					created_at: string;
					status: RegistrationStatus | null;
					class_id: string | null;
					team_id: string | null;
					registration_name: string | null;
					guardian_consent_given_at: string | null;
					reviewed_by: string | null;
					reviewed_at: string | null;
				};
				Insert: {
					id: string;
					email: string;
					display_name?: string | null;
					role?: UserRole;
					created_at?: string;
					status?: RegistrationStatus | null;
					class_id?: string | null;
					team_id?: string | null;
					registration_name?: string | null;
					guardian_consent_given_at?: string | null;
					reviewed_by?: string | null;
					reviewed_at?: string | null;
				};
				Update: {
					id?: string;
					email?: string;
					display_name?: string | null;
					role?: UserRole;
					created_at?: string;
					status?: RegistrationStatus | null;
					class_id?: string | null;
					team_id?: string | null;
					registration_name?: string | null;
					guardian_consent_given_at?: string | null;
					reviewed_by?: string | null;
					reviewed_at?: string | null;
				};
				Relationships: [];
			};
			teams: {
				Row: {
					id: string;
					name: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					name: string;
					created_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					created_at?: string;
				};
				Relationships: [];
			};
			classes: {
				Row: {
					id: string;
					name: string;
					code: string;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					name: string;
					code: string;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					code?: string;
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			class_teachers: {
				Row: {
					class_id: string;
					teacher_id: string;
					assigned_at: string;
				};
				Insert: {
					class_id: string;
					teacher_id: string;
					assigned_at?: string;
				};
				Update: {
					class_id?: string;
					teacher_id?: string;
					assigned_at?: string;
				};
				Relationships: [];
			};
			app_settings: {
				Row: {
					key: string;
					value: unknown;
					description: string | null;
					updated_at: string;
				};
				Insert: {
					key: string;
					value: unknown;
					description?: string | null;
					updated_at?: string;
				};
				Update: {
					key?: string;
					value?: unknown;
					description?: string | null;
					updated_at?: string;
				};
				Relationships: [];
			};
			skill_status_history: {
				Row: {
					id: string;
					student_id: string;
					class_id: string;
					skill_area: SkillArea;
					level: SkillLevel;
					notes: string | null;
					recorded_by: string | null;
					recorded_at: string;
				};
				Insert: {
					id?: string;
					student_id: string;
					class_id: string;
					skill_area: SkillArea;
					level: SkillLevel;
					notes?: string | null;
					recorded_by?: string | null;
					recorded_at?: string;
				};
				Update: {
					id?: string;
					student_id?: string;
					class_id?: string;
					skill_area?: SkillArea;
					level?: SkillLevel;
					notes?: string | null;
					recorded_by?: string | null;
					recorded_at?: string;
				};
				Relationships: [];
			};
			attendance_records: {
				Row: {
					id: string;
					student_id: string;
					class_id: string;
					present: boolean;
					notes: string | null;
					recorded_by: string | null;
					recorded_at: string;
					session_date: string;
				};
				Insert: {
					id?: string;
					student_id: string;
					class_id: string;
					present: boolean;
					notes?: string | null;
					recorded_by?: string | null;
					recorded_at?: string;
					session_date?: string;
				};
				Update: {
					id?: string;
					student_id?: string;
					class_id?: string;
					present?: boolean;
					notes?: string | null;
					recorded_by?: string | null;
					recorded_at?: string;
					session_date?: string;
				};
				Relationships: [];
			};
			homework_assignments: {
				Row: {
					id: string;
					class_id: string;
					title: string;
					skill_area: SkillArea;
					reference_link: string | null;
					recurrence_rule: unknown | null;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					class_id: string;
					title: string;
					skill_area: SkillArea;
					reference_link?: string | null;
					recurrence_rule?: unknown | null;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					class_id?: string;
					title?: string;
					skill_area?: SkillArea;
					reference_link?: string | null;
					recurrence_rule?: unknown | null;
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			homework_instances: {
				Row: {
					id: string;
					assignment_id: string;
					class_id: string;
					period_start: string;
					due_date: string;
					archived_at: string | null;
					archived_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					assignment_id: string;
					class_id: string;
					period_start: string;
					due_date: string;
					archived_at?: string | null;
					archived_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					assignment_id?: string;
					class_id?: string;
					period_start?: string;
					due_date?: string;
					archived_at?: string | null;
					archived_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			homework_status_history: {
				Row: {
					id: string;
					instance_id: string;
					student_id: string;
					class_id: string;
					status: HomeworkStatusValue;
					recorded_by: string | null;
					recorded_at: string;
				};
				Insert: {
					id?: string;
					instance_id: string;
					student_id: string;
					class_id: string;
					status: HomeworkStatusValue;
					recorded_by?: string | null;
					recorded_at?: string;
				};
				Update: {
					id?: string;
					instance_id?: string;
					student_id?: string;
					class_id?: string;
					status?: HomeworkStatusValue;
					recorded_by?: string | null;
					recorded_at?: string;
				};
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: {
			is_admin: {
				Args: Record<string, never>;
				Returns: boolean;
			};
			is_teacher_of_class: {
				Args: { target_class_id: string };
				Returns: boolean;
			};
			validate_class_code: {
				Args: { p_code: string };
				Returns: { id: string; name: string }[];
			};
			check_registration_available: {
				Args: { p_class_id: string; p_registration_name: string };
				Returns: boolean;
			};
			is_targeted_for_homework_instance: {
				Args: { target_instance_id: string };
				Returns: boolean;
			};
			is_targeted_for_homework_assignment: {
				Args: { target_assignment_id: string };
				Returns: boolean;
			};
		};
		Enums: {
			user_role: UserRole;
			registration_status: RegistrationStatus;
			skill_area: SkillArea;
			skill_level: SkillLevel;
		};
	};
};
