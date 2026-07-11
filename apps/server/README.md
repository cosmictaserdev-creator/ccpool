# ccpool-server

The multi-tenant HTTP server for [ccpool](https://github.com/hexxt-git/ccpool) — the
one path to the shared ledger. Most groups don't need this: the [`ccpool`](https://www.npmjs.com/package/ccpool)
CLI points at a hosted server by default, so there's nothing to deploy. Install this
only if your group wants to **run its own server**.

The server is multi-tenant (many groups on one server, each ledger isolated by a
`group_id` in one shared database) and runs on **libSQL** — one `DATABASE_URL` covers
both a local SQLite file and a remote `libsql://` (Turso).

## Run it

```sh
# local SQLite file
DATABASE_URL=file:/var/lib/ccpool/server.db PORT=8787 npx ccpool-server

# remote libSQL / Turso
DATABASE_URL=libsql://your-db.turso.io CCPOOL_DB_AUTH_TOKEN=… PORT=8787 npx ccpool-server
```

Or install it globally and run the `ccpool-server` binary:

```sh
npm install -g ccpool-server
DATABASE_URL=file:/var/lib/ccpool/server.db ccpool-server
```

## Environment

| Variable               | Required | Description                                                  |
| ---------------------- | -------- | ------------------------------------------------------------ |
| `DATABASE_URL`         | yes      | A `file:` path (local SQLite) or a `libsql://…` (Turso) URL. |
| `CCPOOL_DB_AUTH_TOKEN` | remote   | Auth token for a remote `libsql://` database.                |
| `PORT`                 | no       | Port to listen on (default `8787`).                          |

The schema (ledger + registry tables) is brought up idempotently on boot — there's
nothing to migrate by hand.

## Point CLIs at it

Members set `CCPOOL_SERVER_URL=https://your-host` when running `ccpool init`. Run the
server behind TLS: the bearer token rides on every request, so the CLI refuses plain
`http://` for anything but localhost. Passwords are stored as salted scrypt hashes and
tokens as sha256 hashes — the server never keeps a usable credential.

See [Storage &amp; server](https://ccpool.hexxt.dev/docs/algorithm/storage-and-server) for how
tenancy and the two-password model work.

## License

MIT
