/** #115: which message the error page shows for a status. */
export type ErrorKind = 'not-found' | 'forbidden' | 'generic';

export function errorKind(status: number): ErrorKind {
	if (status === 404) return 'not-found';
	if (status === 401 || status === 403) return 'forbidden';
	return 'generic';
}
