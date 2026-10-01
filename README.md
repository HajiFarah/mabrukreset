# Mabruk GS

## Setup

Prerequisites: a Supabase account, a modern browser, and `npx serve` or another static file server.

1. Clone or download this repository.
2. Open `js/config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for your Supabase project.
3. In the Supabase SQL editor, run `supabase/schema.sql`.
4. Then run `supabase/functions.sql` in the SQL editor.
5. Then run `supabase/policies.sql` in the SQL editor.
6. In Supabase Auth settings, create one user with the shop owner's email and password.
7. Run `npx serve` from the project folder and open the URL it prints.
8. Log in with the owner account. Done.

## Deployment

Upload all files to Vercel or Netlify. Set no build command. Publish directory is the project root.

Replace `icons/icon-192.png` and `icons/icon-512.png` with real icons before deploying. The icon files are placeholders documented in `icons/README.txt`.