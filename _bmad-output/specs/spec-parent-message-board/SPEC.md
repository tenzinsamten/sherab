---
id: SPEC-parent-message-board
companions:
  - brownfield.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# School message board

## Why

A pain to solve. Parent members asked for one place to post messages the whole school community sees. Today tib-class has no shared channel: no announcements, no posts table, no board route. Parents, teachers and admins pass news by other means, and students never see it. The board gives admins, teachers and admin-chosen parents one voice to everyone, with a push alert so the news is seen.

## Capabilities

- **CAP-1**
  - **intent:** Any signed-in, approved user of any role (admin, teacher, parent, student) can read the board.
  - **success:** Each role sees all posts, newest first, each with author name, posted time, body and attachments. A signed-out, pending or rejected user can't read any post, through the page or directly through the database.
- **CAP-2**
  - **intent:** Admins, teachers and parents granted posting can publish a post with a body and up to 2 PDF attachments.
  - **success:** A post from an allowed role appears at once for every reader. A student, or a parent without the grant, sees no post form, and the database refuses the insert and the file upload.
- **CAP-3**
  - **intent:** Authors can edit or delete their own posts, and admins and teachers can delete any post.
  - **success:** An edit shows for all readers. A deleted post and its files disappear for everyone. Any other user's edit or delete is refused by the database.
- **CAP-4**
  - **intent:** An admin can turn posting on or off for each approved parent.
  - **success:** Turning it on makes the post form appear for that parent and lets their inserts through. Turning it off refuses that parent's new posts but keeps their earlier posts. Only an admin can change the grant.
- **CAP-5**
  - **intent:** Readers learn about a new post through a push notification.
  - **success:** A new post sends one push to every subscribed browser except the author's own, students included. Opening the push opens the board. An edit sends no push.

## Constraints

- RLS is the barrier for reads, inserts, updates, deletes and file storage. Hiding a form in the UI is not security.
- Attachments follow the homework-file rules: PDF only, 5 MB each, at most 2 per post, private bucket, signed URLs.
- Push reuses the existing pipeline. It does nothing while the `VAPID_*` variables are unset, and it batches within Cloudflare's 50-subrequest limit, as homework push does.
- `src/lib/supabase/database.types.ts` is maintained by hand. Never regenerate it. The new migration starts at `0061`.
- All UI text goes in `messages/en.json`, `de.json` and `bo.json`.
- Before any commit: reset the DB, then `npm test`, `npm run check` and `npm run build` exit 0.

## Non-goals

- No per-class boards. There is one school-wide board.
- No replies, comments, reactions or pinned posts.
- No approval queue before a post appears.
- No posting by students, and no posting grant that teachers can give.
- No email notifications.
- No expiry or archiving. Posts stay until someone deletes them.
- Admins and teachers can't edit other people's posts. They can only delete them.

## Success signal

- A granted parent posts "Picnic on Saturday" with a PDF flyer. A student and a teacher, on their own phones, get the push, open the board and see the post with the flyer. A non-granted parent's insert fails in an RLS test.

## Assumptions

- A parent's grant stops working once the parent is no longer approved, because `is_parent()` requires approval.
- Editing a post sends no new push.
- The board is a top-level route (for example `/board`), linked from every role's navigation.
- The body uses the existing rich-text editor and size limit (`MAX_CONTENT_BYTES`) from homework.

