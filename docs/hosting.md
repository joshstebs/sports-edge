# Host SportsEdge

SportsEdge serves the web app and API on one port. It can run on a Docker host or a Node.js VPS independently of Vercel. **My Picks** supports manual pick entry, grading, and export as soon as the app is running. Analyst chat, paid odds feeds, Stripe, BetTrack, and BetIQ are optional.

## Create accounts and storage

Use Node.js 24. From the repository root:

```sh
npm ci
npm ci --prefix server
umask 077
npm run --silent auth:generate --prefix server -- --admin admin --tester tester > .env.host-seed
```

Save the printed passwords in your password manager. The environment file contains password hashes and the session secret. Keep both values on the host and preserve account IDs when moving an existing ledger. For a brand-new ledger, use a new volume or data directory.

In the hosting dashboard or your private environment file, set:

| Variable | Value |
| --- | --- |
| `AUTH_USERS_JSON` | The generated JSON array. In a hosting dashboard paste the JSON without the shell quoting. |
| `AUTH_SESSION_SECRET` | The generated session secret. |
| `APP_ORIGIN` | The exact HTTPS origin users will open, for example `https://sports.example.com`. |
| `TRUST_PROXY_HOPS` | `1` for one trusted reverse proxy that is the only route to the app. Default `0`. |
| `PORT` | Defaults to `3000`. Use the platform's supplied port if applicable. |
| `SPORTS_EDGE_DATA_DIR` | Absolute path on writable persistent storage. The container defaults to `/data`. |

For a Docker `--env-file`, strip the generator's outer single quotes from the `AUTH_USERS_JSON` value. Docker reads that file literally. For Node’s `server/.env` file, the generated quoting works as written.

Use one running instance with local JSON storage. If you already use Upstash REST storage, configure both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. That selects Redis instead of local files.

## Render Free

Create a Free Docker web service pointed at the SportsEdge deployment branch. Set the generated account JSON and session secret as environment variables. Add both Upstash Redis REST settings, `TRUST_PROXY_HOPS=1`, and `SPORTS_EDGE_REQUIRE_REDIS=true`. The last setting prevents startup if the persistent backend is missing. SportsEdge uses Render’s assigned HTTPS URL as the allowed origin unless you set `APP_ORIGIN` explicitly. Use `/api/health` for health checks. The free filesystem is temporary, so the ledger belongs in Redis.

## Docker host

With a private Docker-compatible environment file saved as `.env.host`:

```sh
docker build -t sportsedge .
docker volume create sportsedge-data
docker run -d --name sportsedge --restart unless-stopped \
  --env-file .env.host \
  --mount type=volume,source=sportsedge-data,target=/data \
  -p 127.0.0.1:3000:3000 sportsedge
```

If the build runs behind a proxy with a custom certificate authority, use `docker build --secret id=proxy_ca,src=/path/to/ca.pem -t sportsedge .` to provide its signing certificate during dependency installation.

On a managed Docker host, use the repository's Dockerfile, mount a persistent disk at `/data`, and set the health path to `/api/health`. The container runs as UID 1000, which must be able to write the mount. Configure HTTPS on the host. On a VPS with Caddy on the same machine, a minimal Caddyfile is:

```caddyfile
sports.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## Node.js host

Set the hosting variables in `server/.env` or through the service manager. For a reverse proxy on the same machine, set `HOST=127.0.0.1`.

```sh
npm ci
npm ci --prefix server
npm run build
npm run build:server
npm start
```

Run the start command under your platform's service manager to restart it on reboot. Use the health check and HTTPS reverse proxy above.

## Verify and keep your records

1. Load the HTTPS site and sign in as your admin. In **My Picks**, log a pick at American odds and mark its result after it settles.
2. Restart the app and confirm the pick is still visible. If it is missing, inspect the host's volume mount or data path before logging more picks.
3. Use **My Picks → Export all picks** to download your own history as JSON. For a full restorable backup, stop the service and copy the data directory or volume. Keep the account configuration separately in your password manager or secret store so restored rows still match the same account IDs.

To enable the optional data feeds, see the [SportsEdge connector guide](super-app.md). An LLM provider key enables analyst chat. BetTrack and BetIQ require their own running backends.
