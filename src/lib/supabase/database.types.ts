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
					class_session_id: string;
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
					class_session_id: string;
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
					class_session_id?: string;
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
						foreignKeyName: 'attendance_records_class_session_fkey';
						columns: ['class_session_id', 'class_id'];
						isOneToOne: false;
						referencedRelation: 'class_sessions';
						referencedColumns: ['id', 'class_id'];
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
			badges_earned: {
				Row: {
					badge_type: BadgeType;
					earned_at: string;
					id: string;
					milestone: number;
					student_id: string;
				};
				Insert: {
					badge_type: BadgeType;
					earned_at?: string;
					id?: string;
					milestone: number;
					student_id: string;
				};
				Update: {
					badge_type?: BadgeType;
					earned_at?: string;
					id?: string;
					milestone?: number;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'badges_earned_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			class_days: {
				Row: {
					cancelled: boolean;
					created_at: string;
					created_by: string | null;
					day: string;
					id: string;
				};
				Insert: {
					cancelled?: boolean;
					created_at?: string;
					created_by?: string | null;
					day: string;
					id?: string;
				};
				Update: {
					cancelled?: boolean;
					created_at?: string;
					created_by?: string | null;
					day?: string;
					id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_days_created_by_fkey';
						columns: ['created_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			class_sessions: {
				Row: {
					cancelled: boolean;
					class_day_id: string;
					class_id: string;
					duration_minutes_override: number | null;
					extra: boolean;
					id: string;
					start_time_override: string | null;
					updated_at: string;
					updated_by: string | null;
				};
				Insert: {
					cancelled?: boolean;
					class_day_id: string;
					class_id: string;
					duration_minutes_override?: number | null;
					extra?: boolean;
					id?: string;
					start_time_override?: string | null;
					updated_at?: string;
					updated_by?: string | null;
				};
				Update: {
					cancelled?: boolean;
					class_day_id?: string;
					class_id?: string;
					duration_minutes_override?: number | null;
					extra?: boolean;
					id?: string;
					start_time_override?: string | null;
					updated_at?: string;
					updated_by?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'class_sessions_class_day_id_fkey';
						columns: ['class_day_id'];
						isOneToOne: false;
						referencedRelation: 'class_days';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_sessions_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_sessions_updated_by_fkey';
						columns: ['updated_by'];
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
			class_enrollments: {
				Row: {
					class_id: string;
					enrolled_at: string;
					enrolled_by: string | null;
					student_id: string;
				};
				Insert: {
					class_id: string;
					enrolled_at?: string;
					enrolled_by?: string | null;
					student_id: string;
				};
				Update: {
					class_id?: string;
					enrolled_at?: string;
					enrolled_by?: string | null;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_enrollments_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_enrollments_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			class_join_requests: {
				Row: {
					class_id: string;
					dismissed_at: string | null;
					id: string;
					requested_at: string;
					reviewed_at: string | null;
					reviewed_by: string | null;
					status: 'pending' | 'approved' | 'rejected';
					student_id: string;
				};
				Insert: {
					class_id: string;
					dismissed_at?: string | null;
					id?: string;
					requested_at?: string;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					status?: 'pending' | 'approved' | 'rejected';
					student_id: string;
				};
				Update: {
					class_id?: string;
					dismissed_at?: string | null;
					id?: string;
					requested_at?: string;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					status?: 'pending' | 'approved' | 'rejected';
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_join_requests_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_join_requests_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_join_requests_reviewed_by_fkey';
						columns: ['reviewed_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			class_syllabi: {
				Row: {
					class_id: string;
					content: string | null;
					content_doc: unknown | null;
					content_language: string;
					created_at: string;
					created_by: string | null;
					id: string;
					links: HomeworkReferenceLink[];
					school_year: number;
					updated_at: string;
				};
				Insert: {
					class_id: string;
					content?: string | null;
					content_doc?: unknown | null;
					content_language?: string;
					created_at?: string;
					created_by?: string | null;
					id?: string;
					links?: HomeworkReferenceLink[];
					school_year: number;
					updated_at?: string;
				};
				Update: {
					class_id?: string;
					content?: string | null;
					content_doc?: unknown | null;
					content_language?: string;
					created_at?: string;
					created_by?: string | null;
					id?: string;
					links?: HomeworkReferenceLink[];
					school_year?: number;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_syllabi_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					}
				];
			};
			class_syllabus_section_files: {
				Row: {
					created_at: string;
					created_by: string | null;
					file_name: string;
					id: string;
					object_path: string;
					section_id: string;
					size_bytes: number;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					created_by?: string | null;
					file_name: string;
					id?: string;
					object_path: string;
					section_id: string;
					size_bytes: number;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					created_by?: string | null;
					file_name?: string;
					id?: string;
					object_path?: string;
					section_id?: string;
					size_bytes?: number;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_syllabus_section_files_section_id_fkey';
						columns: ['section_id'];
						isOneToOne: false;
						referencedRelation: 'class_syllabus_sections';
						referencedColumns: ['id'];
					}
				];
			};
			class_syllabus_sections: {
				Row: {
					content_doc: unknown | null;
					content_language: string;
					created_at: string;
					created_by: string | null;
					id: string;
					links: HomeworkReferenceLink[];
					position: number;
					syllabus_id: string;
					title: string;
					updated_at: string;
				};
				Insert: {
					content_doc?: unknown | null;
					content_language?: string;
					created_at?: string;
					created_by?: string | null;
					id?: string;
					links?: HomeworkReferenceLink[];
					position: number;
					syllabus_id: string;
					title: string;
					updated_at?: string;
				};
				Update: {
					content_doc?: unknown | null;
					content_language?: string;
					created_at?: string;
					created_by?: string | null;
					id?: string;
					links?: HomeworkReferenceLink[];
					position?: number;
					syllabus_id?: string;
					title?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'class_syllabus_sections_syllabus_id_fkey';
						columns: ['syllabus_id'];
						isOneToOne: false;
						referencedRelation: 'class_syllabi';
						referencedColumns: ['id'];
					}
				];
			};
			classes: {
				Row: {
					code: string;
					created_at: string;
					created_by: string | null;
					default_duration_minutes: number | null;
					default_start_time: string | null;
					id: string;
					name: string;
					name_bo: string | null;
					name_de: string | null;
					schedule_ends_on: string | null;
					schedule_interval_weeks: number;
					schedule_starts_on: string;
					schedule_weekdays: number[];
					syllabus: string | null;
					syllabus_links: HomeworkReferenceLink[];
				};
				Insert: {
					code: string;
					created_at?: string;
					created_by?: string | null;
					default_duration_minutes?: number | null;
					default_start_time?: string | null;
					id?: string;
					name: string;
					name_bo?: string | null;
					name_de?: string | null;
					schedule_ends_on?: string | null;
					schedule_interval_weeks?: number;
					schedule_starts_on?: string;
					schedule_weekdays?: number[];
					syllabus?: string | null;
					syllabus_links?: HomeworkReferenceLink[];
				};
				Update: {
					code?: string;
					created_at?: string;
					created_by?: string | null;
					default_duration_minutes?: number | null;
					default_start_time?: string | null;
					id?: string;
					name?: string;
					name_bo?: string | null;
					name_de?: string | null;
					schedule_ends_on?: string | null;
					schedule_interval_weeks?: number;
					schedule_starts_on?: string;
					schedule_weekdays?: number[];
					syllabus?: string | null;
					syllabus_links?: HomeworkReferenceLink[];
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
			deletion_requests: {
				Row: {
					id: string;
					requested_at: string;
					requested_by: string | null;
					requester_role: 'parent';
					reviewed_at: string | null;
					reviewed_by: string | null;
					status: 'pending' | 'approved' | 'rejected';
					student_id: string | null;
				};
				Insert: {
					id?: string;
					requested_at?: string;
					requested_by?: string | null;
					requester_role?: 'parent';
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					status?: 'pending' | 'approved' | 'rejected';
					student_id?: string | null;
				};
				Update: {
					id?: string;
					requested_at?: string;
					requested_by?: string | null;
					requester_role?: 'parent';
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					status?: 'pending' | 'approved' | 'rejected';
					student_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'deletion_requests_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'deletion_requests_requested_by_fkey';
						columns: ['requested_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'deletion_requests_reviewed_by_fkey';
						columns: ['reviewed_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			homework_assignments: {
				Row: {
					class_id: string;
					content: unknown | null;
					content_language: string;
					created_at: string;
					created_by: string | null;
					description: string | null;
					due_offset_days: number | null;
					ends_on: string | null;
					id: string;
					paused_at: string | null;
					recurrence_rule: unknown | null;
					recurrence_start_date: string | null;
					reference_link: string | null;
					reference_links: HomeworkReferenceLink[];
					skill_area: Database['public']['Enums']['skill_area'];
					title: string;
					whole_class: boolean;
				};
				Insert: {
					class_id: string;
					content?: unknown | null;
					content_language?: string;
					created_at?: string;
					created_by?: string | null;
					description?: string | null;
					due_offset_days?: number | null;
					ends_on?: string | null;
					id?: string;
					paused_at?: string | null;
					recurrence_rule?: unknown | null;
					recurrence_start_date?: string | null;
					reference_link?: string | null;
					reference_links?: HomeworkReferenceLink[];
					skill_area: Database['public']['Enums']['skill_area'];
					title: string;
					whole_class?: boolean;
				};
				Update: {
					class_id?: string;
					content?: unknown | null;
					content_language?: string;
					created_at?: string;
					created_by?: string | null;
					description?: string | null;
					due_offset_days?: number | null;
					ends_on?: string | null;
					id?: string;
					paused_at?: string | null;
					recurrence_rule?: unknown | null;
					recurrence_start_date?: string | null;
					reference_link?: string | null;
					reference_links?: HomeworkReferenceLink[];
					skill_area?: Database['public']['Enums']['skill_area'];
					title?: string;
					whole_class?: boolean;
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
			parents: {
				Row: {
					created_at: string;
					id: string;
					reviewed_at: string | null;
					reviewed_by: string | null;
					status: Database['public']['Enums']['parent_status'];
				};
				Insert: {
					created_at?: string;
					id: string;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					status?: Database['public']['Enums']['parent_status'];
				};
				Update: {
					created_at?: string;
					id?: string;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					status?: Database['public']['Enums']['parent_status'];
				};
				Relationships: [
					{
						foreignKeyName: 'parents_id_fkey';
						columns: ['id'];
						isOneToOne: true;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'parents_reviewed_by_fkey';
						columns: ['reviewed_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			push_notification_log: {
				Row: {
					instance_id: string;
					kind: 'added' | 'due_soon' | 'overdue';
					recipient_id: string;
					sent_at: string;
					student_id: string;
				};
				Insert: {
					instance_id: string;
					kind: 'added' | 'due_soon' | 'overdue';
					recipient_id: string;
					sent_at?: string;
					student_id: string;
				};
				Update: {
					instance_id?: string;
					kind?: 'added' | 'due_soon' | 'overdue';
					recipient_id?: string;
					sent_at?: string;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'push_notification_log_instance_id_fkey';
						columns: ['instance_id'];
						isOneToOne: false;
						referencedRelation: 'homework_instances';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'push_notification_log_recipient_id_fkey';
						columns: ['recipient_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'push_notification_log_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			push_subscriptions: {
				Row: {
					auth: string;
					created_at: string;
					endpoint: string;
					id: string;
					locale: 'en' | 'de' | 'bo';
					p256dh: string;
					profile_id: string;
					updated_at: string;
				};
				Insert: {
					auth: string;
					created_at?: string;
					endpoint: string;
					id?: string;
					locale: 'en' | 'de' | 'bo';
					p256dh: string;
					profile_id: string;
					updated_at?: string;
				};
				Update: {
					auth?: string;
					created_at?: string;
					endpoint?: string;
					id?: string;
					locale?: 'en' | 'de' | 'bo';
					p256dh?: string;
					profile_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'push_subscriptions_profile_id_fkey';
						columns: ['profile_id'];
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
					parent_id: string | null;
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
					parent_id?: string | null;
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
					parent_id?: string | null;
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
						foreignKeyName: 'profiles_parent_id_fkey';
						columns: ['parent_id'];
						isOneToOne: false;
						referencedRelation: 'parents';
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
			session_leave_history: {
				Row: {
					answer: 'coming' | 'on_leave' | 'sick';
					answered_at: string;
					answered_by: string | null;
					class_session_id: string;
					classification: 'planned' | 'short_notice' | null;
					id: number;
					student_id: string;
				};
				Insert: {
					answer: 'coming' | 'on_leave' | 'sick';
					answered_at?: string;
					answered_by?: string | null;
					class_session_id: string;
					classification?: 'planned' | 'short_notice' | null;
					id?: never;
					student_id: string;
				};
				Update: {
					answer?: 'coming' | 'on_leave' | 'sick';
					answered_at?: string;
					answered_by?: string | null;
					class_session_id?: string;
					classification?: 'planned' | 'short_notice' | null;
					id?: never;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'session_leave_history_class_session_id_fkey';
						columns: ['class_session_id'];
						isOneToOne: false;
						referencedRelation: 'class_sessions';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'session_leave_history_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'session_leave_history_answered_by_fkey';
						columns: ['answered_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			sick_leave_decisions: {
				Row: {
					class_session_id: string;
					decided_at: string;
					decided_by: string | null;
					decision: 'approved' | 'rejected';
					id: number;
					student_id: string;
				};
				Insert: {
					class_session_id: string;
					decided_at?: string;
					decided_by?: string | null;
					decision: 'approved' | 'rejected';
					id?: never;
					student_id: string;
				};
				Update: {
					class_session_id?: string;
					decided_at?: string;
					decided_by?: string | null;
					decision?: 'approved' | 'rejected';
					id?: never;
					student_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'sick_leave_decisions_class_session_id_fkey';
						columns: ['class_session_id'];
						isOneToOne: false;
						referencedRelation: 'class_sessions';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'sick_leave_decisions_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'sick_leave_decisions_decided_by_fkey';
						columns: ['decided_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			student_streaks: {
				Row: {
					class_id: string;
					current_streak: number;
					last_qualifying_week: string | null;
					student_id: string;
					updated_at: string;
				};
				Insert: {
					class_id: string;
					current_streak?: number;
					last_qualifying_week?: string | null;
					student_id: string;
					updated_at?: string;
				};
				Update: {
					class_id?: string;
					current_streak?: number;
					last_qualifying_week?: string | null;
					student_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'student_streaks_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'student_streaks_student_id_fkey';
						columns: ['student_id'];
						isOneToOne: true;
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
					name_bo: string | null;
					name_de: string | null;
				};
				Insert: {
					created_at?: string;
					id?: string;
					name: string;
					name_bo?: string | null;
					name_de?: string | null;
				};
				Update: {
					created_at?: string;
					id?: string;
					name?: string;
					name_bo?: string | null;
					name_de?: string | null;
				};
				Relationships: [];
			};
		};
		Views: {
			class_sessions_effective: {
				Row: {
					cancelled: boolean | null;
					class_day_id: string | null;
					class_id: string | null;
					class_name: string | null;
					class_name_bo: string | null;
					class_name_de: string | null;
					day: string | null;
					day_cancelled: boolean | null;
					duration_minutes: number | null;
					duration_minutes_override: number | null;
					extra: boolean | null;
					id: string | null;
					session_cancelled: boolean | null;
					start_time: string | null;
					start_time_override: string | null;
					starts_at: string | null;
					updated_at: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'class_sessions_class_day_id_fkey';
						columns: ['class_day_id'];
						isOneToOne: false;
						referencedRelation: 'class_days';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'class_sessions_class_id_fkey';
						columns: ['class_id'];
						isOneToOne: false;
						referencedRelation: 'classes';
						referencedColumns: ['id'];
					}
				];
			};
		};
		Functions: {
			check_registration_available: {
				Args: { p_class_id: string; p_registration_name: string };
				Returns: boolean;
			};
			generate_recurring_homework_instances: { Args: never; Returns: number };
			class_people: {
				Args: { p_class_id: string };
				Returns: { person_id: string; display_name: string; is_teacher: boolean }[];
			};
			enroll_student: {
				Args: { p_class_id: string; p_student_id: string };
				Returns: undefined;
			};
			unenroll_student: {
				Args: { p_class_id: string; p_student_id: string };
				Returns: undefined;
			};
			linked_children: {
				Args: never;
				Returns: {
					id: string;
					name: string;
					status: Database['public']['Enums']['registration_status'];
				}[];
			};
			list_enrollable_students: {
				Args: { p_class_id: string };
				Returns: {
					id: string;
					display_name: string | null;
					email: string | null;
					class_names: string;
					class_names_bo: string;
					class_names_de: string;
				}[];
			};
			is_enrolled_in_class: {
				Args: { p_student: string; p_class: string };
				Returns: boolean;
			};
			is_teacher_of_student: { Args: { p_student: string }; Returns: boolean };
			set_class_default: {
				Args: {
					p_class_id: string;
					p_duration_minutes: number | null;
					p_start_time: string | null;
				};
				Returns: undefined;
			};
			set_class_schedule: {
				Args: {
					p_class_id: string;
					p_weekdays: number[];
					p_start_time: string | null;
					p_duration_minutes: number | null;
					p_starts_on: string;
					p_ends_on: string | null;
					p_interval_weeks?: number;
				};
				Returns: undefined;
			};
			class_schedule_from_sessions: {
				Args: { p_class_id: string };
				Returns: { weekdays: number[]; starts_on: string };
			};
			attendance_backfill_session: {
				Args: { p_class_id: string; p_day: string };
				Returns: string;
			};
			move_syllabus_section: {
				Args: {
					p_section_id: string;
					p_syllabus_id: string;
					p_class_id: string;
					p_direction: string;
				};
				Returns: 'moved' | 'unchanged' | null;
			};
			syllabus_sections_backfill: { Args: never; Returns: number };
			compute_student_streak: {
				Args: { p_student_id: string; p_class_id: string; p_as_of_week?: string };
				Returns: { current_streak: number; last_qualifying_week: string | null };
			};
			add_extra_session: {
				Args: {
					p_class_id: string;
					p_class_day_id: string;
					p_start_time: string | null;
					p_duration_minutes: number | null;
				};
				Returns: string;
			};
			set_class_syllabus: {
				Args: { p_class_id: string; p_syllabus: string; p_links: HomeworkReferenceLink[] };
				Returns: undefined;
			};
			is_admin: { Args: never; Returns: boolean };
			is_parent: { Args: never; Returns: boolean };
			is_parent_of: { Args: { p_student_id: string }; Returns: boolean };
			is_parent_in_class: { Args: { p_class_id: string }; Returns: boolean };
			is_parent_targeted_for_homework_assignment: {
				Args: { p_assignment_id: string };
				Returns: boolean;
			};
			is_parent_targeted_for_homework_instance: {
				Args: { p_instance_id: string };
				Returns: boolean;
			};
			homework_counts: {
				Args: { p_student_id: string };
				Returns: { open_count: number; overdue_count: number }[];
			};
			save_push_subscription: {
				Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_locale: string };
				Returns: undefined;
			};
			delete_push_subscription: {
				Args: { p_endpoint: string };
				Returns: undefined;
			};
			homework_push_targets: {
				Args: { p_kind: string; p_instance_id?: string };
				Returns: {
					recipient_id: string;
					student_id: string;
					student_name: string | null;
					instance_id: string;
					title: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					due_date: string;
				}[];
			};
			trigger_homework_push: {
				Args: { p_kind?: string; p_instance_id?: string; p_depth?: number };
				Returns: number | null;
			};
			session_starts_at: {
				Args: { p_class_session_id: string };
				Returns: string;
			};
			preview_leave: {
				Args: { p_class_session_id: string; p_student_id: string };
				Returns: 'planned' | 'short_notice' | null;
			};
			preview_leave_range: {
				Args: {
					p_student: string;
					p_from: string;
					p_to: string;
					p_class?: string | null;
					p_answer?: 'on_leave' | 'coming';
				};
				Returns: {
					session_id: string;
					day: string;
					class_id: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					outcome: LeaveRangeOutcome;
				}[];
			};
			set_leave_range: {
				Args: {
					p_student: string;
					p_from: string;
					p_to: string;
					p_class: string | null;
					p_answer: 'on_leave' | 'coming';
				};
				Returns: {
					session_id: string;
					day: string;
					class_id: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					outcome: LeaveRangeOutcome;
				}[];
			};
			classify_leave: {
				Args: { p_class_session_id: string; p_at: string };
				Returns: 'planned' | 'short_notice' | null;
			};
			session_leave_masked: {
				Args: { p_class_session_id: string };
				Returns: {
					student_id: string;
					display_name: string;
					answer: 'coming' | 'on_leave';
				}[];
			};
			approve_stale_sick_leave: {
				Args: never;
				Returns: number;
			};
			sick_leave_queue: {
				Args: never;
				Returns: {
					class_session_id: string;
					student_id: string;
					student_name: string;
					class_id: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					day: string;
					start_time: string | null;
					answered_at: string;
					decision: 'approved' | 'rejected' | null;
					decided_at: string | null;
					decided_by_system: boolean;
					own_child: boolean;
				}[];
			};
			child_attendance: {
				Args: { p_student_id: string };
				Returns: {
					session_date: string;
					class_id: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					present: boolean;
				}[];
			};
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
			recompute_student_badges: {
				Args: { p_badge_type: string; p_student_id: string };
				Returns: undefined;
			};
			recompute_student_streak: {
				Args: { p_class_id: string; p_student_id: string };
				Returns: undefined;
			};
			team_leaderboard: {
				Args: never;
				Returns: {
					team_id: string;
					team_name: string;
					team_name_bo: string | null;
					team_name_de: string | null;
					total_streak: number;
				}[];
			};
			request_class_join: {
				Args: { p_code: string };
				Returns: string;
			};
			request_parent_access: {
				Args: never;
				Returns: Database['public']['Enums']['parent_status'];
			};
			promote_parent_to_teacher: {
				Args: { p_user_id: string };
				Returns: string;
			};
			demote_teacher_to_parent: {
				Args: { p_user_id: string };
				Returns: string;
			};
			list_class_join_requests: {
				Args: never;
				Returns: {
					request_id: string;
					student_id: string;
					student_name: string | null;
					current_classes: string;
					current_classes_bo: string;
					current_classes_de: string;
					class_id: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					requested_at: string;
					own_child: boolean;
				}[];
			};
			decide_class_join: {
				Args: { p_request_id: string; p_decision: 'approved' | 'rejected' };
				Returns: undefined;
			};
			dismiss_class_join: {
				Args: { p_request_id: string };
				Returns: undefined;
			};
			my_class_join_requests: {
				Args: never;
				Returns: {
					id: string;
					class_id: string;
					class_name: string;
					class_name_bo: string | null;
					class_name_de: string | null;
					status: 'pending' | 'rejected';
					requested_at: string;
					reviewed_at: string | null;
				}[];
			};
			validate_class_code: {
				Args: { p_code: string };
				Returns: {
					id: string;
					name: string;
					name_bo: string | null;
					name_de: string | null;
				}[];
			};
		};
		Enums: {
			parent_status: 'pending' | 'approved' | 'rejected';
			registration_status: 'pending' | 'approved' | 'rejected';
			skill_area: 'language' | 'song' | 'dance';
			skill_level: 'not_started' | 'learning' | 'confident';
			user_role: 'admin' | 'teacher' | 'student' | 'parent';
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
			parent_status: ['pending', 'approved', 'rejected'],
			registration_status: ['pending', 'approved', 'rejected'],
			skill_area: ['language', 'song', 'dance'],
			skill_level: ['not_started', 'learning', 'confident'],
			user_role: ['admin', 'teacher', 'student', 'parent']
		}
	}
} as const;

export type UserRole = Database['public']['Enums']['user_role'];
export type RegistrationStatus = Database['public']['Enums']['registration_status'];
export type SkillArea = Database['public']['Enums']['skill_area'];
export type SkillLevel = Database['public']['Enums']['skill_level'];
export type HomeworkStatusValue = 'assigned' | 'done' | 'reviewed';
export type BadgeType = 'attendance' | 'homework';
/** One entry of homework_assignments.reference_links (0013). */
export type HomeworkReferenceLink = { url: string; label: string | null };
/** B11 (#57): what a leave-range save does (did) to one session (0030). */
export type LeaveRangeOutcome =
	| 'planned'
	| 'short_notice'
	| 'coming'
	| 'already_on_leave'
	| 'already_coming'
	| 'started'
	| 'cancelled'
	| 'decided'
	| 'sick'
	/** Refused at save time for another reason (e.g. the session was deleted). */
	| 'skipped';
