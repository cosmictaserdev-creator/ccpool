# ccshare — Resource Utilization Summary

This document details the resources ccshare consumes, based on the number of
users ($N$) in a group.

Since the rewrite there is **one architecture**: every machine reaches the shared
ledger over HTTP through the ccshare server, and the server owns the only
database. So there are two very different cost centres:

- **The server database** — a single relational database (Postgres _or_ libSQL)
  holding every group's ledger, with each row scoped by a `group_id` foreign key
  to the `groups` table. This is where all storage, writes, and heavy reads live.
- **The client (per machine)** — the CLI/daemon/TUI. It never opens a database;
  its only cost is HTTP requests to the server (one ingest per minute, one view
  poll every 2 s, almost all answered `304`).

All ledger tables live in one database and are kept inside a strict **8-day
retention window** (`RETENTION_MS`), so storage stabilizes after 8 days.

---

## 1. Server Storage Consumption (in KB)

The dominant cost is the ledger (samples, messages, markers, resets) — roughly
**~3,700 KB per user**. On top of that:

- **`group_id` overhead**: one short text column per ledger row. At ~4,400 rows
  per user in the window this is only ~0.2 MB per user, and it is what lets a
  single database hold every group (no schema-per-group, no database-per-group).
- **Registry overhead**: the `groups` / `members` / `tokens` rows — ~0.25 KB per
  user, plus one small `groups` row per group.

| Number of Users ($N$) | Ledger Storage (KB) | + group_id/registry (KB) | Total (approx) |
| :-------------------: | :-----------------: | :----------------------: | :------------: |
|      **1 User**       |      ~3,700 KB      |         ~200 KB          |    ~3.9 MB     |
|      **5 Users**      |     ~18,500 KB      |        ~1,000 KB         |    ~19.5 MB    |
|     **10 Users**      |     ~37,000 KB      |        ~2,000 KB         |    ~39.0 MB    |
|     **50 Users**      |     ~185,000 KB     |        ~10,000 KB        |   ~195.0 MB    |
|     **100 Users**     |     ~370,000 KB     |        ~20,000 KB        |   ~390.0 MB    |

The figures are identical whether the server runs on Postgres or libSQL — the
adapters implement the same relational model.

---

## 2. Database Writes (per Day)

Writes happen **only on the server**, driven by each machine's daemon ticking
every 60 seconds (1,440 ticks/day per machine). A tick is one batched
transaction (`POST /v1/ingest` → one `recordBatch`), which bumps that group's
change token once.

- **Ledger writes**: ~4,420 rows per user/day (samples + one change-token bump per
  tick + measured messages).
- **Registry writes**: ~1,440 token-touches per user/day (throttled to at most one
  per minute).

| Number of Users ($N$) | Ledger Writes / Day | Registry Writes / Day | Total Writes / Day |
| :-------------------: | :-----------------: | :-------------------: | :----------------: |
|      **1 User**       |       ~4,420        |        ~1,440         |       ~5,860       |
|      **5 Users**      |       ~22,100       |        ~7,200         |      ~29,300       |
|     **10 Users**      |       ~44,200       |        ~14,400        |      ~58,600       |
|     **50 Users**      |      ~221,000       |        ~72,000        |      ~293,000      |
|     **100 Users**     |      ~442,000       |       ~144,000        |      ~593,000      |

Each machine itself issues just **~1,440 HTTP POSTs/day** (one per tick); the
server turns those into the writes above.

---

## 3. Database Reads (per Hour of TUI Viewing)

Reads are driven by active viewers ($V$) polling the TUI (every 2 s) and the
statusline. The read path is **watermark-cached**: `GET /v1/view` first checks a
single-row change token (the ETag), and only re-runs the heavy 7-day window
queries when the token — or the 60 s time bucket — moves.

- **Client side**: each viewer issues ~1,800 `GET /v1/view` per hour. In steady
  state almost all are bodyless `304`s backed by one single-row `SELECT` scoped by
  `group_id`.
- **Server side (heavy queries)**: the group's view is computed **at most once per
  minute group-wide**, no matter how many members are watching, because the server
  caches the computed `SharedView` behind the change token. Each recompute reads
  $\approx 20,880 \times N$ rows.

### Total Heavy Rows Read per Hour (Group-wide)

| Number of Users ($N$) | Heavy Rows Read / Hour (Group-wide) |
| :-------------------: | :---------------------------------: |
|      **1 User**       |             ~1,250,000              |
|      **5 Users**      |             ~6,260,000              |
|     **10 Users**      |             ~12,520,000             |
|     **50 Users**      |             ~62,600,000             |
|     **100 Users**     |            ~125,200,000             |

_Heavy reads scale with group size but not with the number of viewers: the server
recomputes the view at most once per minute and serves the cached copy (or a
`304`) to every member. A steady-state poll costs the database a single
`group_id`-scoped single-row `SELECT`._
