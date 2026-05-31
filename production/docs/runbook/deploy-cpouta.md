# Runbook — Deploy BloomOulu on CSC cPouta

**Owner:** whoever holds the CSC project (student account on project `2017571`)
**Target environment:** a single cPouta VM — **demo / educational** deployment
**Time budget:** ~15 min of portal clicks + ~20–40 min unattended on the VM
**Payments:** MOCK mode only (test cards). No real money moves — this is what
keeps the deployment inside CSC's academic acceptable-use policy. **Do not**
switch Paytrail out of mock or enable MobilePay here.

This deploys the whole platform (web, api, worker, admin, kiosk, Postgres+
pgvector, Redis, Caddy with HTTPS, Ollama LLM, reranker) onto one VM with
`docker compose`. The observability (LGTM) stack is off by default to keep the
VM lean.

The work splits into **three parts**:

- **Part A** — things only *you* can do in the CSC web portal (provision a VM).
- **Part B** — one command on the VM (fully automated by `deploy-cpouta.sh`).
- **Part C** — verify, and the day-2 / TLS / troubleshooting notes.

---

## Part 0 — Prerequisite: publish the deploy files (one-time)

The VM's first-boot script clones this repo from GitHub. The CSC-specific files
must therefore exist **on the branch the VM clones**:

```
production/docker-compose.csc.yml
production/infra/caddy/Caddyfile.csc
production/infra/cloud-init.cpouta.yaml
production/.env.csc.example
production/scripts/deploy-cpouta.sh
```

Push them to `https://github.com/hsn07pk/BloomOulu.git` first. Either merge them
to `main` (the cloud-init default) **or** note your branch name and set
`REPO_BRANCH` in the cloud-init below to match.

> No secrets are committed: `.env.csc.example` is a template full of
> `REPLACE_ME_*` placeholders, and `.dockerignore` keeps any real `.env` out of
> the images. The deploy script generates every secret on the VM at first run.

---

## Part A — CSC portal steps (you, in the browser)

Reference: <https://docs.csc.fi/cloud/pouta/>. The Pouta dashboard is OpenStack
Horizon at <https://pouta.csc.fi>.

### A1. Enable Pouta on the project

1. Go to <https://my.csc.fi> → open project **2017571**.
2. **Add services** → enable **Pouta** (accept the terms if prompted).
3. Wait until Pouta shows as active on the project (a few minutes).

> Pouta bills in Billing Units (BU) per hour the VM exists. A demo VM left
> running costs BUs continuously — **stop/delete it when you're done** (Part C).

### A2. Log in to the dashboard and pick the project

1. Open <https://pouta.csc.fi> and log in.
2. Top-left project selector → choose **project_2017571**.

### A3. Import your SSH key

**Compute → Key Pairs → Import Public Key.** Paste your `~/.ssh/id_ed25519.pub`
(or `id_rsa.pub`). Name it e.g. `my-laptop`.

### A4. Security group (firewall)

**Network → Security Groups → Create Security Group** → name `bloomoulu-web`.
Add **Ingress** rules (Add Rule):

| Rule | Port | Remote CIDR | Why |
|------|------|-------------|-----|
| SSH | 22 | *your IP*`/32` (or `0.0.0.0/0`) | shell access |
| HTTP | 80 | `0.0.0.0/0` | Caddy ACME challenge + redirect |
| HTTPS | 443 | `0.0.0.0/0` | the site |

Everything else stays closed. The deploy binds all other ports to `127.0.0.1`
on the VM, so even with a loose group only Caddy is reachable on the public IP.

### A5. Allocate a floating IP

**Network → Floating IPs → Allocate IP to Project** (pool: the public/external
network). Note the IP, e.g. `195.148.30.10`. You'll associate it in A7.

### A6. Launch the instance

**Compute → Instances → Launch Instance:**

- **Details** → name `bloomoulu`.
- **Source** → Boot from **image**, select an **Ubuntu 22.04** (or 24.04) image.
  Set **Create New Volume = Yes**, **Volume Size ≥ 40 GB** (Docker images +
  Ollama models + reranker weights need room; 40 GB is comfortable).
- **Flavor** → **≥ 8 GB RAM**. Ollama (`gemma3:4b`) plus the reranker are the
  memory hogs. Recommended: **`standard.xlarge` (8 vCPU / 16 GB)**. `standard.large`
  (4/8 GB) works but is tight — see troubleshooting if Ollama gets OOM-killed.
  *(Optional: a `gpu.*` P100 flavor speeds up the LLM; then uncomment the GPU
  block in `docker-compose.csc.yml` and install nvidia-container-toolkit.)*
- **Networks** → the project's private network.
- **Security Groups** → add `bloomoulu-web` (A4).
- **Key Pair** → your key (A3).
- **Configuration → Customization Script** → paste the **entire contents of**
  `production/infra/cloud-init.cpouta.yaml`. If your deploy files are on a branch
  other than `main`, edit the `REPO_BRANCH=` line in that pasted text first.
- **Launch**.

### A7. Associate the floating IP

When the instance is **Active**: its row → dropdown → **Associate Floating IP**
→ pick the IP from A5.

### A8. Wait for first-boot provisioning

cloud-init installs Docker and clones the repo (~2–4 min). SSH in:

```bash
ssh ubuntu@195.148.30.10        # use YOUR floating IP
```

You'll see a banner telling you to run `sudo bloomoulu-deploy`. If the banner
isn't there yet, provisioning is still running — check:

```bash
cloud-init status --wait          # blocks until first-boot finishes
```

That's the end of the portal-only work.

---

## Part B — Deploy (one command on the VM)

```bash
sudo bloomoulu-deploy
```

That helper auto-detects the floating IP and uses `<dashed-ip>.sslip.io` as the
public hostname (sslip.io resolves `*.195-148-30-10.sslip.io` → your IP for
free, so the `admin.` and `kiosk.` subdomains work without owning a domain).

To pin a real domain instead (you must point its DNS A record — and a wildcard
or `admin`/`kiosk` records — at the floating IP first):

```bash
sudo bloomoulu-deploy bloom.example.fi
```

`deploy-cpouta.sh` then runs end to end (first run ~20–40 min, mostly the image
build + model pull):

1. installs Docker if the image somehow lacks it;
2. renders `production/.env` from `.env.csc.example` — substitutes the host and
   **generates `AUTH_SECRET`, the Postgres password, the bank-transfer HMAC, and
   a random admin password** (only on first run; re-runs reuse `.env` so the DB
   volume password never drifts);
3. builds all images (the web image bakes the public URLs at build time);
4. hashes the admin password with the app's own bcryptjs and writes it
   `$$`-escaped into `.env` (Compose interpolates `$`, so the hash is doubled);
5. starts Postgres/Redis/Ollama, waits for the DB, runs `prisma migrate deploy`
   and the seed (tiers, settings, Finnish flora, emails, content, admin user);
6. brings up the whole stack behind Caddy (automatic HTTPS);
7. pulls the Ollama models and builds the RAG corpus (best-effort);
8. verifies health and prints the URLs + the **admin login**.

> **Save the admin password** — it's printed **once**, at the very end. Only its
> hash is stored on disk.

---

## Part C — Verify, operate, tear down

### C1. Smoke test

With `PUBLIC_HOST` = `195-148-30-10.sslip.io` (your dashed IP):

- **Public site** — `https://195-148-30-10.sslip.io` → loads, redirects to `/en`.
- **Operator** — `https://admin.195-148-30-10.sslip.io/admin` → log in with the
  printed `admin@bloomoulu.demo` + password.
- **Kiosk** — `https://kiosk.195-148-30-10.sslip.io`.

Default TLS is **self-signed**, so the browser shows a one-time warning
("Proceed anyway") — expected. See C3 for trusted certs.

**Mock payment test** (no real money): start a donation/adoption, choose
Paytrail, and pay with a Paytrail **test card** (e.g. Nordea test card from
<https://docs.paytrail.com/#/?id=test-credentials>). The receipt + donor-wall
flow completes against the mock.

### C2. Day-2 commands (run from `/opt/bloomoulu/production`)

```bash
cd /opt/bloomoulu/production
CC="docker compose -f docker-compose.yml -f docker-compose.csc.yml"

$CC ps                 # status
$CC logs -f api        # follow a service's logs
$CC restart api        # restart one service
$CC down               # stop everything (keeps volumes/data)
$CC up -d              # start again

# Update to the latest code:
git pull && sudo /opt/bloomoulu/production/scripts/deploy-cpouta.sh <your-host>
# (.env is preserved; images rebuild; migrations re-apply idempotently.)

# Turn ON observability (Grafana/Prometheus/etc.) when you need it:
COMPOSE_PROFILES=observability $CC up -d
```

### C3. Switch to trusted (Let's Encrypt) certificates

Only works on a **publicly resolvable** host (a real domain, or sslip.io) with
ports 80+443 open. Edit `/opt/bloomoulu/production/.env`:

```
CADDY_TLS=
CADDY_ACME_EMAIL=you@example.org
```

(empty `CADDY_TLS` switches Caddy from `tls internal` to automatic ACME) then:

```bash
cd /opt/bloomoulu/production
docker compose -f docker-compose.yml -f docker-compose.csc.yml up -d caddy
```

Caddy fetches and renews certs automatically. See also
[`dns-and-tls.md`](dns-and-tls.md).

### C4. Stop billing when finished

A running VM keeps consuming Billing Units. In the dashboard: **Compute →
Instances →** your instance → **Delete Instance** (and **Network → Floating IPs
→ Release** the IP) when the demo is over. To pause without losing data, just
`docker compose ... down` and **Shelve** the instance.

---

## Troubleshooting

**`admin` login rejected.** The admin User row is created by the seed from
`ADMIN_BOOTSTRAP_EMAIL`; the password is checked against the `$$`-escaped hash in
`.env`. Re-running the script does **not** reset the password (it's only printed
on the first run). To rotate it, delete the `ADMIN_BOOTSTRAP_PASSWORD_HASH` line
and the `.env` admin lines and re-run — or set a new hash by hand:
`docker compose ... run --rm --no-deps --entrypoint sh api -c 'node -e "console.log(require(\"bcryptjs\").hashSync(\"NEWPASS\",12))"'`
then write it into `.env` with **every `$` doubled to `$$`**.

**Ollama / model pull failed, or the LLM gets OOM-killed.** The stack still
serves; "Ask the Garden" falls back to retrieval-only. Re-pull after freeing
memory (bigger flavor helps):
`docker compose -f docker-compose.yml -f docker-compose.csc.yml exec ollama ollama pull bge-m3 && ... ollama pull gemma3:4b`,
then re-run the RAG ingest:
`docker compose ... run --rm --no-deps --entrypoint sh api -c 'cd /app && pnpm --filter @bloomoulu/rag run ingest'`.

**`admin.<ip>` / `kiosk.<ip>` won't load.** You used a **bare IP** as the host —
subdomains can't resolve off an IP. Re-run with the dashed sslip form:
`sudo bloomoulu-deploy 195-148-30-10.sslip.io`.

**Browser TLS warning.** Expected with the default self-signed cert. Either click
through, or set up Let's Encrypt (C3).

**Postgres auth fails after I recreated `.env`.** The Postgres password is baked
into the data volume on first init. If you regenerate `.env` (new password) but
keep the old volume, auth breaks. Either keep the original `.env`, or wipe the
volume to re-init: `docker compose ... down -v` **(destroys all data)** then
re-deploy.

**Where's the env reference?** Every variable is documented in
[`../ENV.md`](../ENV.md). The CSC template is `../../.env.csc.example`.
