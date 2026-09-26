# Addendum — Parent Role PRD

## Technical notes (for architecture)

- **Parent↔student link mechanism (user-proposed):** the parent's account email acts as the reference key; a student's guardian email on their registration points to the parent account. Architecture decides whether this is a live email match or a stored foreign key set at match time.
- **Email collision risk (found in code, 0006_guardian_email_verification.sql):** student self-registration signs up to Supabase Auth using the guardian's *real* email as the auth account email until approval swaps it to `{username}@students.internal.invalid`. Supabase Auth emails are unique, so a parent account on the same email — or two siblings pending at once — would collide. Architecture must resolve this; the PRD only requires that registrations and parent signup work in any order (see FRs).
- **Update after parent-first decision:** since students now register only against an approved Parent's (already-confirmed) email, the student sign-up no longer needs the guardian's real email as its Supabase Auth email for confirmation. Architecture can give pending students a synthetic auth email from the start, which removes the unique-email collision above.
