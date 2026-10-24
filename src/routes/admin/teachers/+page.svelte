<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { enhance } from '$app/forms';
	import { num } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { showToast } from '$lib/toast';
	import { createConfirm } from '$lib/confirm.svelte';
	import { createPending } from '$lib/pending.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { ui } from '$lib/ui/classes';
	import type { ActionData, PageProps } from './$types';

	/**
	 * The admin's teachers: create one (email, name, classes), and per
	 * teacher edit their classes inline, reset their password and remove
	 * them (a teacher who is also a parent keeps the parent account, B14b).
	 * Mobile-first story 9b: stacked cards below 80em and a full table from
	 * 80em (as /admin/classes); in a card each value carries its column's
	 * name. The fields and checkboxes are native, so a successful create
	 * clears them with the form reset (no remount). Confirms ask in the new
	 * alert dialog; the one-time password shows in the Requests outcome box.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	type Teacher = (typeof data.teachers)[number];

	const pending = createPending();
	const confirm = createConfirm();

	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let editingId = $state<string | null>(null);

	// B14b (#68): the email belongs to an approved parent-only login. Nothing
	// changed yet; on OK the same form (its values kept: a failed result does
	// not reset it) is resubmitted with promote=1, which makes that login a
	// teacher too.
	let createForm: HTMLFormElement | undefined = $state();
	let promote = $state(false);

	async function confirmPromotion() {
		if (!(await confirm.ask(m.teachers_promote_confirm(), m.teachers_promote_submit()))) return;
		promote = true;
		await tick();
		createForm?.requestSubmit();
		promote = false;
	}

	$effect(() => {
		const result = form;
		if (!result) return;
		// Only `form` is a dependency (editingId is written here).
		untrack(() => {
			if ('promotable' in result && result.promotable) void confirmPromotion();
			if ('promoted' in result && result.promoted)
				showToast('success', m.teachers_promoted_success({ email: result.email ?? '' }));
			if ('updated' in result && result.updated) {
				editingId = null;
				showToast('success', m.teachers_classes_updated({ name: result.updated }));
			}
			if ('removed' in result && result.removed)
				showToast(
					'success',
					'keptParent' in result && result.keptParent
						? m.teachers_removed_kept_parent({ name: result.removed })
						: m.teachers_removed_success({ name: result.removed })
				);
		});
	});

	function teacherName(t: Teacher) {
		return t.display_name ?? t.email;
	}

	// A failed create keeps what was typed and checked; a successful one (and
	// any other result) leaves the fields empty.
	let createdEmail = $derived(
		form && 'email' in form && !('success' in form) && !('reset' in form) ? (form.email ?? '') : ''
	);
	let createdName = $derived(
		form && 'displayName' in form && !('success' in form) ? (form.displayName ?? '') : ''
	);
	let createdClassIds = $derived(
		form && 'classIds' in form && !('success' in form) ? (form.classIds ?? []) : []
	);

	// #117b: a failed create's error under Email, under the classes, or above
	// the button. Create results echo the email (the other actions' errors do
	// not: they stay toast-only); the promotable 409 has no error (its dialog
	// asks). It goes with the next result.
	let createErrorText = $derived(
		form && 'error' in form && form.error && 'email' in form ? form.error : ''
	);
	let createErrorAt = $derived.by((): 'email' | 'classes' | 'form' | null => {
		if (!createErrorText) return null;
		if (
			createErrorText === m.teachers_error_email_required() ||
			createErrorText === m.teachers_error_duplicate() ||
			createErrorText === m.teachers_error_parent_pending()
		)
			return 'email';
		if (createErrorText === m.teachers_error_class_required()) return 'classes';
		return 'form';
	});
	const describedBy = (at: string) => (createErrorAt === at ? `${at}-error` : undefined);

	let credential = $derived(
		form && 'tempPassword' in form && form.tempPassword
			? {
					message:
						'reset' in form && form.reset
							? m.teachers_reset_success({ email: form.email ?? '' })
							: m.teachers_created_success({ email: form.email ?? '' }),
					fields: [
						{ label: m.credential_email(), value: form.email ?? '' },
						{ label: m.teachers_credential_heading(), value: form.tempPassword }
					]
				}
			: null
	);

	// A new one-time password is at the top of the page; it is scrolled into
	// view (focus stays where it is), as on /requests.
	let outcomeBox: HTMLElement | undefined = $state();
	$effect(() => {
		if (!credential) return;
		void tick().then(() => outcomeBox?.scrollIntoView({ block: 'nearest' }));
	});

	// One markup for both layouts: stacked cards below 80em, a table from 80em
	// (copied from /admin/classes).
	const table = 'block w-full min-w-0 xl:table xl:border-collapse';
	const thead = 'hidden xl:table-header-group';
	const th =
		'border-b border-border px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground';
	const tbody = 'flex min-w-0 flex-col gap-3 xl:table-row-group';
	const tr =
		'flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 xl:table-row xl:rounded-none xl:border-0 xl:border-b xl:p-0';
	const td = 'block min-w-0 wrap-break-word xl:table-cell xl:px-3 xl:py-3 xl:align-middle';
	const tdActions = `${td} xl:w-px xl:text-right`;
	const actions = 'flex min-w-0 flex-wrap gap-2 xl:flex-nowrap xl:justify-end';
	/** A form or button holding one row action: full width in a card, its own width in the table. */
	const actionItem = 'min-w-0 flex-1 basis-32 xl:flex-none xl:basis-auto';
	const actionButton = `${ui.touch} w-full gap-2 xl:w-auto`;
	/** A value's column name, shown in a card only (the table has its header). */
	const cardLabel = `${ui.label} mb-1 xl:hidden`;
	const formButton = `${ui.touch} gap-2`;
	const fieldLabel = 'text-sm font-medium wrap-break-word';
	/** A class checkbox: the whole ≥44px row is its label. */
	const checkRow =
		'flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-ring';
	const checkList =
		'grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]';
</script>

<svelte:head>
	<title>{m.teachers_heading()} — Sherab Admin</title>
</svelte:head>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet createError(at: string)}
	{#if createErrorAt === at}
		<p id="{at}-error" class={ui.error}>{createErrorText}</p>
	{/if}
{/snippet}

{#snippet classCheckboxes(isChecked: (id: string) => boolean)}
	<div class={checkList}>
		{#each data.classes as cls (cls.id)}
			<label class={checkRow}>
				<input
					type="checkbox"
					name="classIds"
					value={cls.id}
					checked={isChecked(cls.id)}
					class="size-5 shrink-0 accent-primary"
				/>
				<span class="min-w-0 wrap-break-word">{`${cls.name} (${cls.code})`}</span>
			</label>
		{/each}
	</div>
{/snippet}

<div data-ui="new" class={ui.page} data-hydrated={hydrated || undefined}>
	<header class={ui.header}>
		<div class="min-w-0">
			<p class={ui.kicker}>{m.teachers_section_label()}</p>
			<h1 class={ui.heading}>{m.teachers_heading()}</h1>
		</div>
		<Badge variant="secondary" class="min-h-7 px-3 text-sm" data-testid="page-counter">
			{num(data.teachers.length)}
		</Badge>
	</header>

	{#if credential}
		<!-- One-time password: stays until the next result, unlike a toast. -->
		<div
			bind:this={outcomeBox}
			role="status"
			data-testid="teachers-outcome"
			data-state="success"
			class="flex min-w-0 flex-col gap-2 rounded-lg border border-success bg-success/10 p-4"
		>
			<p class="wrap-break-word">{credential.message}</p>
			<CredentialFields fields={credential.fields} />
		</div>
	{/if}

	<section class="{ui.card} flex flex-col gap-4" data-testid="teacher-create">
		<h2 class={ui.cardTitle}>{m.teachers_create_heading()}</h2>
		{#if data.classes.length === 0}
			<p class={ui.muted}>{m.teachers_need_class_first()}</p>
		{:else}
			<form
				bind:this={createForm}
				method="POST"
				action="?/create"
				class="flex min-w-0 flex-col gap-4"
				use:enhance={pending.submit('create')}
				novalidate
			>
				{#if promote}
					<input type="hidden" name="promote" value="1" />
				{/if}
				<div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
					<!-- The new teacher's email, not a sign-in field (#66). -->
					<div class="flex min-w-0 flex-col gap-1.5">
						<Label for="email" class={fieldLabel}>{m.teachers_email_label()}</Label>
						<Input
							id="email"
							name="email"
							type="email"
							required
							autocomplete="off"
							value={createdEmail}
							aria-invalid={createErrorAt === 'email' ? 'true' : undefined}
							aria-describedby={describedBy('email')}
						/>
						{@render createError('email')}
					</div>
					<div class="flex min-w-0 flex-col gap-1.5">
						<Label for="displayName" class={fieldLabel}>{m.teachers_display_name_label()}</Label>
						<Input id="displayName" name="displayName" autocomplete="off" value={createdName} />
					</div>
				</div>
				<fieldset
					id="classes"
					class="flex min-w-0 flex-col gap-2"
					aria-describedby={describedBy('classes')}
				>
					<legend class="mb-2 {fieldLabel}">{m.teachers_assign_legend()}</legend>
					{@render classCheckboxes((id) => createdClassIds.includes(id))}
					{@render createError('classes')}
				</fieldset>
				{@render createError('form')}
				<div>
					<Button
						type="submit"
						class="{formButton} w-full sm:w-auto"
						aria-busy={pending.is('create') || undefined}
						disabled={pending.busy}
					>
						{#if pending.is('create')}
							<LoaderCircle class="animate-spin" aria-hidden="true" />
						{:else}
							<Plus aria-hidden="true" />
						{/if}
						{m.teachers_create_submit()}
					</Button>
				</div>
			</form>
		{/if}
	</section>

	<section class="{ui.card} flex flex-col gap-3" data-testid="teacher-list">
		<h2 class={ui.cardTitle}>{m.teachers_all_heading()}</h2>
		{#if data.teachers.length === 0}
			<p class={ui.muted}>{m.teachers_empty()}</p>
		{:else}
			<!-- WebKit drops table semantics from a restyled table (cards below 80em): the roles keep them. -->
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<table role="table" class={table}>
				<thead role="rowgroup" class={thead}>
					<tr role="row">
						<th role="columnheader" class={th}>{m.teachers_col_name()}</th>
						<th role="columnheader" class={th}>{m.teachers_col_email()}</th>
						<th role="columnheader" class={th}>{m.teachers_col_classes()}</th>
						<th role="columnheader" class={th}
							><span class="sr-only">{m.teachers_col_actions()}</span></th
						>
					</tr>
				</thead>
				<tbody role="rowgroup" class={tbody}>
					{#each data.teachers as teacher (teacher.id)}
						<tr role="row" class={tr} data-testid="teacher-row" data-teacher-id={teacher.id}>
							<td role="cell" class="{td} font-semibold xl:font-normal">
								<span class="flex min-w-0 flex-wrap items-center gap-2">
									<span class="min-w-0 wrap-break-word">{teacher.display_name ?? '—'}</span>
									{#if teacher.alsoParent}
										<Badge variant="outline">{m.teachers_also_parent()}</Badge>
									{/if}
								</span>
							</td>
							<td role="cell" class="{td} {ui.muted}">
								<p class={cardLabel}>{m.teachers_col_email()}</p>
								<span class="wrap-anywhere">{teacher.email}</span>
							</td>
							<td role="cell" class={td}>
								<p class={cardLabel}>{m.teachers_col_classes()}</p>
								{#if teacher.classes.length === 0}
									<span class={ui.muted}>{m.teachers_none()}</span>
								{:else}
									{teacher.classes.map((c) => `${c.name} (${c.code})`).join(', ')}
								{/if}
							</td>
							<td role="cell" class={tdActions}>
								<div class={actions}>
									<div class={actionItem}>
										<Button
											variant="outline"
											class={actionButton}
											aria-expanded={editingId === teacher.id}
											disabled={pending.busy}
											onclick={() => (editingId = editingId === teacher.id ? null : teacher.id)}
										>
											<Pencil aria-hidden="true" />
											{m.teachers_edit_classes()}
										</Button>
									</div>
									<form
										method="POST"
										action="?/resetPassword"
										class={actionItem}
										use:enhance={pending.submit(`resetPassword:${teacher.id}`, {
											// Asked at submit time (`use:enhance` keeps the options it
											// mounted with): the row's current name.
											confirm: () =>
												confirm.ask(
													m.teachers_reset_confirm({ name: teacherName(teacher) }),
													m.teachers_reset_password()
												)
										})}
									>
										<input type="hidden" name="teacherId" value={teacher.id} />
										<Button
											type="submit"
											variant="outline"
											class={actionButton}
											aria-busy={pending.is(`resetPassword:${teacher.id}`) || undefined}
											disabled={pending.busy}
										>
											{#if pending.is(`resetPassword:${teacher.id}`)}
												<LoaderCircle class="animate-spin" aria-hidden="true" />
											{:else}
												<KeyRound aria-hidden="true" />
											{/if}
											{m.teachers_reset_password()}
										</Button>
									</form>
									<form
										method="POST"
										action="?/remove"
										class={actionItem}
										use:enhance={pending.submit(`remove:${teacher.id}`, {
											// B14b (#68): a teacher who is also a parent keeps the
											// parent account. Read at submit time, as above.
											confirm: () =>
												confirm.ask(
													teacher.alsoParent
														? m.teachers_remove_confirm_parent({ name: teacherName(teacher) })
														: m.teachers_remove_confirm({ name: teacherName(teacher) }),
													m.teachers_remove(),
													{ destructive: true }
												)
										})}
									>
										<input type="hidden" name="teacherId" value={teacher.id} />
										<Button
											type="submit"
											variant="destructive"
											class={actionButton}
											aria-busy={pending.is(`remove:${teacher.id}`) || undefined}
											disabled={pending.busy}
										>
											{#if pending.is(`remove:${teacher.id}`)}
												<LoaderCircle class="animate-spin" aria-hidden="true" />
											{:else}
												<Trash2 aria-hidden="true" />
											{/if}
											{m.teachers_remove()}
										</Button>
									</form>
								</div>
							</td>
						</tr>
						{#if editingId === teacher.id}
							<tr
								role="row"
								class="{tr} -mt-1 border-primary xl:border-primary"
								data-testid="teacher-edit-row"
							>
								<td role="cell" colspan="4" class="{td} xl:py-4">
									<!-- No reset on success: the client-rendered checkboxes (defaultChecked
									     false) would flash unchecked before the row closes. -->
									<form
										method="POST"
										action="?/updateClasses"
										class="flex min-w-0 flex-col gap-4"
										use:enhance={pending.submit(`updateClasses:${teacher.id}`, { reset: false })}
									>
										<input type="hidden" name="teacherId" value={teacher.id} />
										<fieldset class="flex min-w-0 flex-col gap-2">
											<legend class="mb-3 font-bold wrap-break-word">
												{m.teachers_edit_classes_title({ name: teacherName(teacher) })}
											</legend>
											{@render classCheckboxes((id) => teacher.classes.some((c) => c.id === id))}
										</fieldset>
										<div class="flex min-w-0 flex-wrap gap-2">
											<Button
												type="submit"
												class="{formButton} flex-1 sm:flex-none"
												aria-busy={pending.is(`updateClasses:${teacher.id}`) || undefined}
												disabled={pending.busy}
											>
												{@render spinner(`updateClasses:${teacher.id}`)}
												{m.teachers_save_classes()}
											</Button>
											<Button
												variant="outline"
												class="{formButton} flex-1 sm:flex-none"
												disabled={pending.busy}
												onclick={() => (editingId = null)}
											>
												{m.common_cancel()}
											</Button>
										</div>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<ConfirmDialog {confirm} />
</div>
