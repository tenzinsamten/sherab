import type { ActionFailure } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';

/**
 * What every stored PDF file of the app has in common: syllabus section files
 * (#95, 0039, `syllabus-files.ts`) and homework files (#110, 0053,
 * `homework-files.ts`). Each caller names its bucket, its size limit and its
 * own messages; the steps are the same. Every call uses the caller's own
 * Supabase client, so the table's and the bucket's policies decide who may
 * do what.
 *
 * `label` names the kind of file in the server log ("syllabus file",
 * "homework file").
 */

type Client = SupabaseClient<Database>;

export type PdfStore = { bucket: string; label: string };

/** How long a link made by `signObject` works. */
export const SIGNED_URL_SECONDS = 60;
export const MAX_FILE_NAME_LENGTH = 200;
/** A multipart post is a little larger than the files it carries. */
export const FORM_OVERHEAD_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `%PDF-`: how every PDF file starts. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** Objects per Storage API call, and rows per page, when removing. */
export const REMOVE_BATCH = 100;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

/**
 * The name shown and downloaded for an uploaded file: its own name without
 * any folder or control characters, at most 200 characters, ending in
 * `.pdf`. Never used as the storage path.
 */
export function cleanFileName(raw: string): string {
	const base = (raw.split(/[\\/]/).pop() ?? '').replace(/\p{Cc}/gu, '').trim();
	const stem = [...base.replace(/\.pdf$/i, '')]
		.slice(0, MAX_FILE_NAME_LENGTH - 4)
		.join('')
		.trim();
	return `${stem || 'document'}.pdf`;
}

export type UploadProblem = 'missing' | 'size' | 'type';
export type PdfUpload = { name: string; bytes: ArrayBuffer };

/**
 * Reads one posted file. Accepts it only when it is at most `maxBytes` and
 * its content starts with `%PDF-`, whatever its name or declared type say.
 */
export async function readPdfUpload(
	entry: FormDataEntryValue | null,
	maxBytes: number
): Promise<{ ok: true; value: PdfUpload } | { ok: false; problem: UploadProblem }> {
	// A form posted with no file chosen sends an empty, unnamed file.
	if (!(entry instanceof Blob) || entry.size === 0) return { ok: false, problem: 'missing' };
	if (entry.size > maxBytes) return { ok: false, problem: 'size' };
	const bytes = await entry.arrayBuffer();
	const head = new Uint8Array(bytes, 0, Math.min(PDF_MAGIC.length, bytes.byteLength));
	if (head.length < PDF_MAGIC.length || PDF_MAGIC.some((byte, i) => head[i] !== byte)) {
		return { ok: false, problem: 'type' };
	}
	const name = entry instanceof File ? entry.name : '';
	return { ok: true, value: { name: cleanFileName(name), bytes } };
}

/**
 * Reads a file form without ever holding more than `maxPostBytes` in memory,
 * and returns its fields or the refusal to answer with.
 *
 * - A post that says it is over the limit (`Content-Length`) is refused at
 *   once (`tooLarge`). Its body is read and thrown away piece by piece,
 *   because an unread body makes some servers drop the connection instead
 *   of delivering the answer; its length is known, so that ends.
 * - Any other post -- also one without a usable `Content-Length`, which a
 *   host in front of the app may not pass on -- is read up to the limit. One
 *   byte more and it is refused there, without reading the rest.
 * - A body that is not a form, or breaks off: `broken`.
 */
export async function readFileForm<T extends ActionFailure<Record<string, unknown>>>(
	request: Request,
	maxPostBytes: number,
	refusals: { tooLarge: () => T; broken: () => T }
): Promise<{ formData: FormData } | { refused: T }> {
	const header = request.headers.get('content-length')?.trim() ?? '';
	const reader = request.body?.getReader();
	if (/^\d+$/.test(header) && Number(header) > maxPostBytes) {
		try {
			while (reader && !(await reader.read()).done);
		} catch {
			// The sender gave up: nothing left to read.
		}
		return { refused: refusals.tooLarge() };
	}

	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const next = reader ? await reader.read() : { done: true as const, value: undefined };
			if (next.done) break;
			size += next.value.byteLength;
			if (size > maxPostBytes) {
				await reader?.cancel().catch(() => {});
				return { refused: refusals.tooLarge() };
			}
			chunks.push(next.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		// The same form, from the bytes that were read.
		const formData = await new Response(bytes, {
			headers: { 'content-type': request.headers.get('content-type') ?? '' }
		}).formData();
		return { formData };
	} catch {
		// Not a form, or the post broke off.
		return { refused: refusals.broken() };
	}
}

/**
 * Stores the PDF under a new random name in `folder` (`<class_id>/<parent_id>`);
 * the object's path, or null when storage refuses it.
 */
export async function storeObject(
	supabase: Client,
	store: PdfStore,
	folder: string,
	bytes: ArrayBuffer
): Promise<string | null> {
	const path = `${folder}/${crypto.randomUUID()}.pdf`.toLowerCase();
	// The bytes, not the posted File: the declared type is then ours, since
	// the content was checked to be a PDF whatever the browser called it.
	const { error } = await supabase.storage
		.from(store.bucket)
		.upload(path, bytes, { contentType: 'application/pdf', upsert: false });
	if (error) {
		console.error(`${store.label} upload failed: ${error.message}`);
		return null;
	}
	return path;
}

/**
 * True only when storage says the object is not there. The client answers
 * that with `data: false` and a 400 / 404 error, and throws for any other
 * failure (network, 5xx): those count as "still there".
 */
async function isGone(supabase: Client, store: PdfStore, path: string): Promise<boolean> {
	try {
		const { data, error } = await supabase.storage.from(store.bucket).exists(path);
		if (data !== false) return false;
		if (!error) return true;
		const e = error as { status?: number; originalError?: { status?: number } };
		const status = e.status ?? e.originalError?.status;
		return status === 400 || status === 404;
	} catch {
		return false;
	}
}

/**
 * Removes objects from the bucket. True only when none of them is left:
 * the Storage API answers a refused removal with "nothing removed" rather
 * than an error, so objects it did not report are looked up again.
 */
export async function removeObjects(
	supabase: Client,
	store: PdfStore,
	paths: string[]
): Promise<boolean> {
	const bucket = supabase.storage.from(store.bucket);
	for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
		const batch = paths.slice(i, i + REMOVE_BATCH);
		const { data, error } = await bucket.remove(batch);
		if (error) {
			console.error(`${store.label} removal failed: ${error.message}`);
			return false;
		}
		const removed = new Set((data ?? []).map((object) => object.name));
		for (const path of batch) {
			if (removed.has(path)) continue;
			// Not reported: already gone (fine) or not removed (not fine). Only
			// a clear "not there" counts as gone; a lookup that fails does not.
			if (!(await isGone(supabase, store, path))) {
				console.error(`${store.label} not removed: ${path}`);
				return false;
			}
		}
	}
	return true;
}

/** For an object the app could not remove after a failed step: names it in the server log. */
export async function removeOrLog(supabase: Client, store: PdfStore, path: string) {
	if (!(await removeObjects(supabase, store, [path]))) {
		console.error(`${store.label} left behind in the bucket: ${path}`);
	}
}

/**
 * A link to a stored object that works for about a minute; null when
 * storage refuses. `download` makes the browser save the file under
 * `fileName` instead of showing it.
 */
export async function signObject(
	supabase: Client,
	store: PdfStore,
	path: string,
	fileName: string,
	download: boolean
): Promise<string | null> {
	const { data, error } = await supabase.storage
		.from(store.bucket)
		.createSignedUrl(path, SIGNED_URL_SECONDS);
	if (error || !data?.signedUrl) return null;
	// `download` is added here, not through createSignedUrl's option: the
	// client library encodes it twice, so a name with Tibetan letters would
	// be saved as "%E0%BD%82...". Storage reads it from the address either way.
	return download ? `${data.signedUrl}&download=${encodeURIComponent(fileName)}` : data.signedUrl;
}
