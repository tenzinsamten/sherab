import type { Component } from 'svelte';
import BookOpen from '@lucide/svelte/icons/book-open';
import Calendar from '@lucide/svelte/icons/calendar';
import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import GraduationCap from '@lucide/svelte/icons/graduation-cap';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import Trophy from '@lucide/svelte/icons/trophy';
import UserCheck from '@lucide/svelte/icons/user-check';
import Users from '@lucide/svelte/icons/users';
import UsersRound from '@lucide/svelte/icons/users-round';
import type { NavIcon } from '$lib/nav';

/** The Lucide icon of each nav destination. */
export const navIcons: Record<NavIcon, Component<{ class?: string; 'aria-hidden'?: boolean }>> = {
	dashboard: LayoutDashboard,
	classes: BookOpen,
	teachers: GraduationCap,
	parents: Users,
	teams: UsersRound,
	calendar: Calendar,
	board: MessagesSquare,
	requests: UserCheck,
	leaderboard: Trophy,
	homework: ClipboardList,
	help: CircleQuestionMark,
	more: Ellipsis
};
