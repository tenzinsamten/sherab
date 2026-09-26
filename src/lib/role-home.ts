/** Where a signed-in user lands: their role's start page. Null when signed out. */
export function roleHome(
	role: string | null | undefined
): '/admin' | '/teacher' | '/student' | '/parent' | null {
	if (role === 'admin') return '/admin';
	if (role === 'teacher') return '/teacher';
	if (role === 'student') return '/student';
	if (role === 'parent') return '/parent';
	return null;
}
