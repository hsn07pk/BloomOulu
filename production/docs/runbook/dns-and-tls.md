# Runbook — DNS + TLS configuration

**Owner:** engineering lead + University IT (DNS delegations)
**Time budget:** 30 min once delegations are in place

The whole BloomOulu stack lives behind Caddy, which auto-issues + auto-
renews Let's Encrypt certificates on first request. The only ahead-of-
time work is pointing the right hostnames at the VPS.

## 1. Decide the apex

Two options:

| Choice | Pros | Cons |
|---|---|---|
| **bloomoulu.fi** (own apex) | Crisp brand, donor sees "bloomoulu.fi" everywhere | Requires the University to delegate; FI ccTLD registrant must be FI entity (the University qualifies) |
| **bloomoulu.oulu.fi** (sub of the University) | Inherits University trust; no new domain to manage | URL is longer; the University IT must run the DNS |

ADR-0001 picks the apex `bloomoulu.fi`. If University IT prefers the
subdomain, change every value below by appending `.oulu.fi`.

## 2. Hetzner: provision the VPS

The reference target is a Hetzner CX22 in Helsinki:

- 4 vCPU / 8 GB RAM / 80 GB NVMe
- Approx €4.90 / month + €3 / month for IPv4
- Ubuntu 24.04 LTS

```bash
# On the VPS
apt update && apt install -y docker.io docker-compose-v2 git ufw
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

git clone https://github.com/.../bloomoulu.git /opt/bloomoulu
cd /opt/bloomoulu
cp .env.example .env
$EDITOR .env   # set the real values
```

Note the IPv4 + IPv6 addresses the VPS shows in the Hetzner console.

## 3. DNS records

In your registrar's DNS panel (Domainnameshop, Domainmaster, Cloudflare,
or whatever the University uses for `bloomoulu.fi`), set:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `<VPS-IPv4>` | 300 |
| AAAA | `@` | `<VPS-IPv6>` | 300 |
| A | `www` | `<VPS-IPv4>` | 300 |
| AAAA | `www` | `<VPS-IPv6>` | 300 |
| A | `api` | `<VPS-IPv4>` | 300 |
| AAAA | `api` | `<VPS-IPv6>` | 300 |
| A | `admin` | `<VPS-IPv4>` | 300 |
| AAAA | `admin` | `<VPS-IPv6>` | 300 |
| A | `kiosk` | `<VPS-IPv4>` | 300 |
| AAAA | `kiosk` | `<VPS-IPv6>` | 300 |
| A | `grafana` | `<VPS-IPv4>` | 300 |
| AAAA | `grafana` | `<VPS-IPv6>` | 300 |
| A | `errors` | `<VPS-IPv4>` | 300 |
| AAAA | `errors` | `<VPS-IPv6>` | 300 |
| A | `ntfy` | `<VPS-IPv4>` | 300 |
| AAAA | `ntfy` | `<VPS-IPv6>` | 300 |
| MX | `@` | (delegate to the University mail; not handled here) | |
| TXT | `@` | `v=spf1 -all` (no email from the apex; transactional uses no-reply@bloomoulu.fi via the dedicated Postal MTA) | |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@bloomoulu.fi` | |

Wait for propagation (`dig +short bloomoulu.fi @1.1.1.1`).

## 4. Caddy auto-TLS

`infra/caddy/Caddyfile` already declares the hostnames. On first request
Caddy talks to Let's Encrypt's ACME HTTP-01 challenge over port 80,
issues each certificate, then HTTPS-redirects everything. Renewals run
30 days before expiry, automatically.

Verify after DNS propagates:

```bash
curl -I https://bloomoulu.fi/healthz       # 200
curl -I https://api.bloomoulu.fi/healthz   # 200
curl -I https://admin.bloomoulu.fi/admin   # 302 → /admin/login
ssh root@vps "docker logs bloomoulu-caddy-1 | grep certificate"
```

## 5. SSL Labs + Mozilla Observatory check

After Caddy has issued, run:

- https://www.ssllabs.com/ssltest/analyze.html?d=bloomoulu.fi → target **A+**
- https://observatory.mozilla.org/analyze/bloomoulu.fi → target **A+**

If either reports lower, check Caddyfile for the TLS profile (we ship
`tls_internal_subjects` off in production; the default Caddy profile is
already TLS 1.2+ with secure cipher set). Open a ticket if anything
below A.

## 6. Cert renewal monitoring

Prometheus rule `TLSExpiringSoon` in `infra/prometheus/alerts.yml`:

```yaml
- alert: TLSExpiringSoon
  expr: (probe_ssl_earliest_cert_expiry - time()) < 7 * 86400
  for: 1h
  labels: { severity: page, tier: P0 }
```

If Caddy ever fails to renew, this pages ops 7 days before the
certificate expires. The Grafana **infra** dashboard's "Cert days
remaining" stat shows the cushion in real time.

## 7. Pulling the plug

`UFW allow 22/tcp` keeps SSH open. To take the site down without
losing the DB:

```bash
docker compose stop caddy web api admin kiosk
# Sites are dark, but Postgres/MinIO/restic remain so the data survives.
```

To restore:

```bash
docker compose start caddy web api admin kiosk
```

## Open questions

- Should the University's IT publish `_acme-challenge.bloomoulu.fi` as a
  DNS-01 record so we can issue wildcard certs (one cert, all
  subdomains)? Probably yes for the production deploy; HTTP-01 works for
  individual subdomains but DNS-01 simplifies rotation. Coordinate with
  the University DNS admin.
