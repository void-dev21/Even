# Even — a shared debt tab, with real accounts on your own Supabase database

This version adds email/password accounts on top of the Supabase-backed app: everyone
signs up with their own email and password, debts are tied to real accounts, and only
the person who logged an entry can edit or delete it. You can still add a "guest" for a
friend who doesn't want to create an account.

## 1. Create a free Supabase project

1. Go to https://supabase.com and sign up (free tier is plenty for this).
2. Click "New project". Pick any name and a database password (save it somewhere).
3. Wait ~2 minutes for it to finish provisioning.

## 2. Set up the database tables

1. In your new project, open **SQL Editor** in the left sidebar → **New query**.
2. Open `supabase-schema.sql` from this folder, paste its contents in, and click **Run**.
   This creates the `members` and `entries` tables, the row-level security policies,
   and a trigger that stops anyone but the original adder from editing an entry's
   amount, note, or parties.

## 3. Configure email sign-up (one setting to check)

1. In the Supabase dashboard, go to **Authentication → Providers → Email**.
2. By default, Supabase requires people to click a confirmation link in their email
   before they can log in. For a small friend group this is usually more friction than
   it's worth, so you can turn off **"Confirm email"** here if you'd rather everyone get
   in immediately after signing up. Either setting works with this app — the app
   automatically waits for confirmation if you leave it on.
3. If you deploy this later, also set **Authentication → URL Configuration → Site URL**
   to your deployed URL (e.g. `https://your-app.vercel.app`), so confirmation email
   links point to the right place.

## 4. Get your API keys

1. In the project, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key (not the `service_role` key —
   never put that one in frontend code).

## 5. Configure the app

1. In this folder, copy `.env.example` to a new file named `.env`.
2. Paste in your Project URL and anon key:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

## 6. Run it locally

```bash
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173). Create an account, add an
entry — then check the Supabase dashboard's **Table Editor** and **Authentication →
Users** to see it land there.

## 7. Deploy it so your friends can use it from their phones

The easiest option is **Vercel** (also free):

1. Push this folder to a GitHub repo.
2. Go to https://vercel.com, sign in with GitHub, and import the repo.
3. In the project's settings, add the same two environment variables
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under **Settings → Environment Variables**.
4. Deploy. Vercel gives you a live `https://your-app.vercel.app` link that works on any
   phone or computer.
5. Go back to Supabase's **Authentication → URL Configuration** and set the Site URL
   to that link (see step 3 above), so confirmation emails work correctly.

Netlify works the same way if you'd rather use that instead.

## How accounts and permissions work

- **Sign up** asks for a name, email, and password. Signing up automatically adds you
  as a member of the tab — no separate step.
- **Guests**: anyone signed in can add a person by name only (no account) to track
  debts with someone who doesn't want to sign up. You can remove a guest you added, or
  yourself, but not another registered member — they have to remove themselves.
- **Editing and deleting entries**: only the person who logged an entry can change its
  amount, note, or who it's between, or delete it outright. This is enforced by the
  database itself (a Postgres trigger), not just hidden in the interface — so it holds
  even if someone tries to call the database directly.
- **Confirming an entry**: anyone else in the group can mark someone's entry as
  confirmed. This is intentionally more open, since the whole point is letting the
  other side of a debt acknowledge it.
- **Passwords**: handled entirely by Supabase Auth — this app never sees or stores
  raw passwords itself.

## If you want to go further

- **Password reset / magic links**: Supabase Auth supports both out of the box; ask if
  you'd like them wired into the login screen.
- **Social login** (Google, Apple, etc.) instead of passwords is also a small addition
  via Supabase's provider settings.
- **Tighter guest rules**: right now any signed-in member can add a guest; you could
  restrict that to certain people if the group grows.
