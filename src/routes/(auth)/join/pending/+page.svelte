<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import logo from '$lib/assets/sherab-logo-blue.svg';
	import CredentialFields from '$lib/components/CredentialFields.svelte';
	import JoinSteps from '$lib/components/JoinSteps.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// #100: the username and PIN made at registration, while the receipt
	// cookie lives. Without it the page keeps its generic text.
	let credentials = $derived(
		data.receipt?.username && data.receipt.pin
			? [
					{ label: m.credential_username(), value: data.receipt.username },
					{ label: m.credential_pin(), value: data.receipt.pin }
				]
			: null
	);
</script>

<svelte:head>
	<title>{m.join_pending_heading()} — Sherab</title>
</svelte:head>

<!-- Today's auth card, inlined until the join flow moves to the new UI
     (story 6b): its iX elements must not sit inside AuthCard's new-UI root. -->
<div class="auth-page">
	<div class="auth-card">
		<header class="auth-card-header">
			<img src={logo} alt={m.nav_logo_alt()} width="180" height="100" />
			<h1>{m.join_pending_heading()}</h1>
			<!-- Without credentials on screen the text does not promise a sign-in. -->
			<p>
				{credentials ? m.join_pending_explanation() : m.join_pending_explanation_no_credentials()}
			</p>
		</header>
		<JoinSteps current={4} />
		<p style="text-align:center; margin: 0 0 var(--space-4);">
			<ix-pill variant="warning">{m.join_pending_status_badge()}</ix-pill>
		</p>

		{#if data.receipt}
			<table>
				<tbody>
					<tr>
						<th scope="row" class="muted">{m.join_pending_name_label()}</th>
						<td>{data.receipt.name}</td>
					</tr>
					<tr>
						<th scope="row" class="muted">{m.join_pending_class_label()}</th>
						<td>{data.receipt.className}</td>
					</tr>
				</tbody>
			</table>
			{#if credentials}
				<div class="credentials" data-testid="join-credentials">
					<CredentialFields fields={credentials} />
					<p><strong>{m.join_pending_credentials_once()}</strong></p>
				</div>
			{/if}
			<p>{m.join_pending_teacher_approves()}</p>
		{/if}

		<p class="muted">{m.join_pending_cannot_yet()}</p>

		<div class="auth-card-footer">
			<ix-button variant="secondary" href={resolve('/join')}
				>{m.join_pending_start_over()}</ix-button
			>
			<ix-button href={resolve('/login')}>{m.join_pending_sign_in()}</ix-button>
		</div>
	</div>
</div>

<style>
	.credentials {
		margin: var(--space-4) 0;
	}
</style>
