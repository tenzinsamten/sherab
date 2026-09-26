# Addendum — Parent Role PRD

## Technical notes (for architecture)

- **Parent↔student link mechanism (user-proposed):** the parent's account email acts as the reference key; a student's guardian email on their registration points to the parent account. Architecture decides whether this is a live email match or a stored foreign key set at match time.
- **Email collision risk (found in code, 0006_guardian_email_verification.sql):** student self-registration signs up to Supabase Auth with the guardian's real email until approval; Auth emails are unique. Superseded by the parent-first decision below.
- **Update after parent-first decision:** since students now register only against an approved Parent's (already-confirmed) email, the student sign-up no longer needs the guardian's real email as its Supabase Auth email for confirmation. Architecture can give pending students a synthetic auth email from the start, which removes the unique-email collision above.
- **Dual role (Teacher/Admin + Parent on one login):** today `profiles.role` is a single value. Supporting one login with two roles needs a role model change (e.g. separate parent-role record with its own approval status) and a role switcher in the UI. Architecture decides.
- **Dual role (Teacher/Admin + Parent on one login):** today `profiles.role` is a single value. Supporting one login with two roles needs a role model change (e.g. a separate parent-role record with its own approval status) and a role switcher in the UI. Architecture decides.
