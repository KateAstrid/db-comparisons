# Same message, three databases

This page writes the same short text to SpacetimeDB, Convex, and Supabase, then shows how long each call took in the browser. All three are local processes. The clocks measure those processes on your machine, not a trip across the internet.

Your numbers will differ. Another machine is how this page gets checked.

## Run it

You need Docker, the SpacetimeDB CLI 2.11.x, and Node 20. This copy was started with Node 20.19.5. Convex CLI 1.46.0 failed on Node 21.1.0 here (`util.styleText` is missing).

SpacetimeDB, from this directory:

```bash
export PATH="$HOME/.local/bin:$PATH"
spacetime start
spacetime publish tradeoff-lab-gmqwi --server local
```

Leave `spacetime start` running. The page expects the database name `tradeoff-lab-gmqwi` on `ws://127.0.0.1:3000`. That name is in `client/src/main.ts` and `spacetime.local.json`.

Supabase:

```bash
npx supabase start
```

The API is `http://127.0.0.1:54321`. The key already in the client is the public local demo key that `supabase start` prints. It is not a cloud secret.

Convex, in another terminal:

```bash
cd client
npm install
export PATH="$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"
CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable --tail-logs disable
```

That writes `client/.env.local` with the local URL. The page falls back to `http://127.0.0.1:3210` if the file is missing. Leave `convex dev` running.

The page:

```bash
cd client
npm run dev
```

Open http://127.0.0.1:5173/. The buttons stay off until SpacetimeDB and Convex have opened. The page then clears all three tables.

## What the buttons do

Send writes one body to all three at the same time. An empty box sends the placeholder, `hello`.

The count box chooses how many messages to send together. An empty count means 1. Those bodies are the texts `1`, `2`, `3`, and so on, not the sentence in the message box. Each database starts its writes together, and the three databases start together.

An empty KB box leaves the text short. A whole number from 1 to 1024 makes every body that many times 1024 characters. Typed text stays at the front and the rest is the letter `x`.

Clear deletes the rows. The table under the boxes stays until you reload.

## What a clock is

The save number is wall time in the browser, from the moment that database's writes start until those writes have resolved. Under 10 ms the page shows one decimal. Otherwise it rounds to the nearest millisecond. The table stores those already rounded numbers.

SpacetimeDB and Convex keep a connection open, so the message count updates on that connection during the save. Their read line stays a dash. There is no second request to add.

Supabase's save number is the inserts only. When that database's inserts finish, the page reads `note` back in pages of 1000 rows (`max_rows` in `supabase/config.toml` is 1000). The Supabase column in the table is save plus that read. The read does not wait for Convex.

On a burst, "slowest" is the slowest single write inside that database. "Save" is the wall time for the whole burst. The writes overlap, so save is not the sum of the individual writes. The three databases also overlap, so adding SpacetimeDB, Convex, and Supabase overstates how long you waited.

## What one run establishes

It establishes the browser intervals for this workload, on this process layout, for that click. The workload is a handful of short strings, or a hundred of them started at once. The screen shows a count, not the text of each row.

## What one run does not establish

One click does not rank the products. Supabase's save can come out ahead of Convex or behind it on the next click. The calls never left the machine, so this is not a cloud latency test, and a vendor's published transactions-per-second figure is a different test.

It is also a thin workload. One table, a primary key, no extra indexes, no second user, and no auth check on the write. A thousand messages at once, or large KB bodies, is a stress case. On this laptop a live Convex list of about 100 MB stopped updating, and a Supabase read of that table was cancelled by the statement timeout. Use 1 and 100 if you want a comparison you can read. Use the larger sizes only when you mean to stress the stack.

## Environment for the 11 October 2026 run

Recorded on an Apple M1 with 8 GB of memory, macOS 15.7.7.

| Piece | Version and how it was running |
| --- | --- |
| SpacetimeDB | CLI and server 2.11.0. `spacetime start`, data directory on disk, database `tradeoff-lab-gmqwi`. The module table is served from that process's memory. The server was not started with `--in-memory`, so the data directory still exists after a restart. |
| Convex | CLI 1.46.0, local anonymous backend on port 3210, Node 20.19.5. |
| Supabase | CLI 2.120.0. Postgres image `17.11.0.004`, PostgREST `v16.4`. |
| Docker | 29.5.2 inside Colima, 2 CPUs, 4 GiB RAM, aarch64. |
| Page | Vite 6 on http://127.0.0.1:5173/. |

Supabase on that VM was four containers: `supabase_db`, `supabase_rest`, `supabase_kong`, and `supabase_auth`. Studio, pg_meta, edge runtime, storage, realtime, inbucket, vector, and analytics were stopped. A plain `supabase start` brings them back, and on a 2 CPU VM they compete with Postgres. Stop the extras if you want this layout:

```bash
docker stop \
  supabase_studio_tradeoff-lab \
  supabase_pg_meta_tradeoff-lab \
  supabase_edge_runtime_tradeoff-lab \
  supabase_storage_tradeoff-lab \
  supabase_realtime_tradeoff-lab \
  supabase_inbucket_tradeoff-lab \
  supabase_vector_tradeoff-lab \
  supabase_analytics_tradeoff-lab
```

On this database the `anon` role had `statement_timeout` of 3 seconds. `authenticator` had `statement_timeout` and `lock_timeout` of 8 seconds. Those values are not in the migration. Check `pg_roles` if a large read is cancelled.

```sql
select rolname, rolconfig from pg_roles
where rolname in ('anon', 'authenticator', 'authenticated');
```

## Please rerun it

Clone the repo, start the three local servers, and click Send and Send 100 with the KB box left empty. If you publish a number, say the machine, the versions, which Supabase containers were up, and that the figure is one browser run of this page. If your laptop finishes in a different order, that is still a result from this page. Report the machine with the number.
