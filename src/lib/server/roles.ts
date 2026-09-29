import { locales } from '$lib/paraglide/runtime';
import type { Database } from '$lib/supabase/database.types';

/** A role a login can act in: its profile role, plus `parent` when approved. */
export type Role = Database['public']['Enums']['user_role'];

/**
 * B13 (#68): remembers which of a multi-role login's roles is active. It
 * picks the side menu, the home link, the `/` redirect and the /calendar
 * view (other shared pages still follow profiles.role). A preference only:
 * always checked against the roles the login really holds, never used to
 * grant access -- route guards and RLS read the real capabilities.
 */
export const ACTIVE_ROLE_COOKIE = 'active_role';

const ROLES: readonly Role[] = ['admin', 'teacher', 'student', 'parent'];

export function isRole(value: unknown): value is Role {
	return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * The roles a login holds, primary (profile) role first. `parent` is added
 * only for an approved parents row (is_parent()), never for a pending one.
 */
export function heldRoles(
	profileRole: Role | null | undefined,
	parentStatus: string | null | undefined
): Role[] {
	if (!profileRole) return [];
	const roles: Role[] = [profileRole];
	if (parentStatus === 'approved' && profileRole !== 'parent') roles.push('parent');
	return roles;
}

/** `pathname` without a leading locale segment (`/de/parent` -> `/parent`). */
export function withoutLocale(pathname: string): string {
	const segment = pathname.split('/')[1] ?? '';
	if (!(locales as readonly string[]).includes(segment)) return pathname;
	return pathname.slice(segment.length + 1) || '/';
}

/** The role a role-owned area belongs to (`/parent/**` -> parent), or null for a shared route. */
export function roleForPath(pathname: string): Role | null {
	const segment = pathname.split('/')[1] ?? '';
	return isRole(segment) ? segment : null;
}

/**
 * The active role: the URL's role area when the login holds it; else a
 * held role from the cookie; else the primary role. A forged or stale
 * cookie value is ignored. Null for a login with no role.
 */
export function activeRole(
	held: readonly Role[],
	cookie: string | null | undefined,
	pathname: string
): Role | null {
	if (held.length === 0) return null;
	const fromPath = roleForPath(pathname);
	if (fromPath && held.includes(fromPath)) return fromPath;
	if (isRole(cookie) && held.includes(cookie)) return cookie;
	return held[0];
}
