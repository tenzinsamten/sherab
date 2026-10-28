import * as m from '$lib/paraglide/messages.js';
import type { PgError } from './class-join';

/**
 * spec-second-parent story 4 (AD-4, AD-10): remove_parent_link (0057) names
 * its refusal in the error hint; 42501 without a known hint = not allowed
 * (or no such link, which looks the same). The keep-one trigger's backstop
 * raises last_parent_link with 23514, so the hint is read first.
 */
export function removeParentLinkErrorMessage(err: PgError): string {
	switch (err?.hint) {
		case 'own_child':
			return m.parents_link_error_own_child();
		case 'link_removed':
			return m.parents_link_error_removed();
		case 'last_parent_link':
			return m.parents_link_error_last();
	}
	if (err?.code === '42501') return m.parents_link_error_not_allowed();
	return m.parents_link_error_failed();
}
