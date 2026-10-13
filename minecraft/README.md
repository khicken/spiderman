# Minecraft

A Minecraft Java Edition 1.21 clone that runs in the browser at kalebkim.com/minecraft.

## Accounts and cloud saves

Players can sign in with a username and password. Worlds, options, key binds, the resource pack selection and the multiplayer name then sync across devices. Pack files stay on each device. Advancements are part of each world save, so they sync with the world.

Set these environment variables on Vercel:

- `SESSION_SECRET`: a random string of 32 or more characters. It signs the session cookie. Without it, accounts are off in production.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: an Upstash Redis database. It stores users, sessions, settings and the world index.
- `BLOB_READ_WRITE_TOKEN` (optional): a private Vercel Blob store for world data. Without it, world data goes into Redis in parts under 1 MB.

With none of these set, `npm run dev` stores everything in `.data/` (gitignored). Each account gets 50 MB of cloud storage.
