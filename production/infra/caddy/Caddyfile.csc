# ─── BloomOulu Caddy reverse proxy — CSC cPouta profile ──────────────────
# Driven entirely by env (set in .env, injected by docker-compose.csc.yml):
#
#   PUBLIC_HOST        the public hostname, e.g. 10-1-2-3.sslip.io or bloom.example.fi
#   CADDY_TLS          "tls internal" (default, self-signed) or "" for Let's Encrypt
#   CADDY_ACME_EMAIL   contact email used only when CADDY_TLS is empty (real certs)
#
# Topology = the single-host model the app is built for: the public site is
# served by `web`, whose Next.js rewrites forward /v1/* and /webhooks/* to the
# api on the same origin (see apps/web/next.config.mjs + API_REWRITE_TARGET).
# admin + kiosk get their own subdomains. Use a hostname (sslip.io or a real
# domain) for PUBLIC_HOST so the subdomains resolve — a bare IP can't have
# admin.<ip>.

# No global options block needed — TLS is controlled per-site via {$CADDY_TLS}
# below. Default "tls internal" = self-signed; for a trusted cert on a
# resolvable host set CADDY_TLS to "" (Let's Encrypt) or "tls you@org.fi".
# (A bare global `email` with an empty CADDY_ACME_EMAIL makes Caddy refuse
#  to start, so we don't emit one.)

# ── Public donor website (also serves /v1/* + /webhooks/* via web rewrites) ──
{$PUBLIC_HOST} {
	{$CADDY_TLS}
	encode zstd gzip
	reverse_proxy web:3000 {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-Proto {scheme}
		lb_try_duration 5s
		lb_try_interval 250ms
	}
	header {
		Strict-Transport-Security "max-age=63072000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(), camera=(), microphone=()"
	}
}

# ── Operator panel (AdminJS) ─────────────────────────────────────────────
# Open to all by default for a demo. To lock it to campus/VPN, add an
# @allowed remote_ip matcher (see infra/caddy/Caddyfile for the pattern).
admin.{$PUBLIC_HOST} {
	{$CADDY_TLS}
	encode zstd gzip
	reverse_proxy admin:4100 {
		header_up X-Forwarded-Proto {scheme}
	}
	header Strict-Transport-Security "max-age=63072000"
}

# ── Greenhouse kiosk display ─────────────────────────────────────────────
kiosk.{$PUBLIC_HOST} {
	{$CADDY_TLS}
	encode zstd gzip
	reverse_proxy kiosk:3100 {
		header_up X-Forwarded-Proto {scheme}
	}
}
