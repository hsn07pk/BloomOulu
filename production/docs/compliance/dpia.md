# Data Protection Impact Assessment (DPIA) — BloomOulu

> ⚠ **DRAFT.** Reviewed by engineering. Must be signed off by the University
> of Oulu Data Protection Officer (DPO) before production launch. The
> DPO email, Y-tunnus, and supervisory-authority contact below are
> placeholders pending confirmation.

**Document owner:** Team Meraki — engineering side · University of Oulu DPO — legal side
**Last updated:** 2026-06-17
**Status:** Draft for DPO review
**Triggering criteria (Art. 35 GDPR):** Large-scale processing of donor PII
+ financial data; automated AI generation grounded on user input
(AskTheGarden); processing in the context of EAA 2025 accessibility
disclosures. None of the Art. 35(3) high-risk triggers apply on their
own, but the combination warrants a DPIA per WP29 guideline.

---

## 1. Description of the processing operations

### 1.1 Donation + payment

- **Data subjects:** Garden donors (mostly Finnish residents; some EU + non-EU diaspora).
- **Categories of personal data:** email (always); name, postal address (when the donor opts in, e.g. for a posted reward); locale, home-region code; donation record + payment reference; receipt PDFs. The payment itself is processed by the **University of Oulu donation channel** (the University is the payment controller); BloomOulu stores the donation record + reference, not card data.
- **Special categories (Art. 9):** none.
- **Children's data (Art. 8):** not collected; donors must be 18+ per Terms §2.
- **Purposes:** complete the **one-time donation**, issue a VAT-compliant receipt, retain financial records for 6 years per Finnish Kirjanpitolaki 2:5 §, send transactional emails (receipt), produce annual tax certificates. No recurring billing, renewal, or dunning — donations are one-time.
- **Legal basis:** Art. 6(1)(b) performance of contract; Art. 6(1)(c) legal obligation (accounting law); Art. 6(1)(f) legitimate interest (fraud prevention, audit log).

### 1.2 AskTheGarden RAG chat

- **Data subjects:** any visitor (logged-in or anonymous).
- **Categories of personal data:** the visitor's question text (free-form, may contain PII the visitor chooses to include); IP and user-agent at the API edge; locale.
- **Purposes:** retrieve the relevant curator-authored chunks from the pgvector store, ground the LLM answer, surface citation chips, log low-confidence answers for curator review.
- **Legal basis:** Art. 6(1)(f) legitimate interest, with the visitor's reasonable expectation that a public chat surface processes their question to answer it.
- **AI specifics:** LLM inference + retrieval run on the University's **Lehmus AI** service (University of Oulu / CSC), within the **EEA** — no question text is transferred outside the EEA. Citations are required — answers that retrieve below the score floor (cosine 0.72 by default) short-circuit to a "forward to curator" escalation card rather than hallucinating. *To confirm before launch: whether any live web-search fallback (which could reach a non-EEA source) is retained; if so it must be added to the transfers list in the privacy policy.*

### 1.3 Transactional email

- **Data subjects:** donors who completed an adoption.
- **Categories:** name, email, the specific receipt + adoption metadata.
- **Purposes:** deliver receipt, dunning, renewal reminder, plaque-ready, tax certificate.
- **Legal basis:** Art. 6(1)(b).
- **Recipient:** self-hosted Postal SMTP (University-controlled) → recipient's mail provider.

### 1.4 Kiosk telemetry

- **Data subjects:** none (kiosks display, they don't identify visitors).
- **Categories:** kiosk device fingerprint hash, heartbeat timestamps, anonymous QR-scan counts per plant.
- **Purposes:** keep the lobby kiosks online, surface "scanned-this-week" stats to curators.
- **Legal basis:** Art. 6(1)(f).

### 1.5 Favourites / votes (leaderboard)

- **Data subjects:** any visitor who taps the ♥ on a plant.
- **Categories of personal data:** a one-way SHA-256 **visitorHash** of (IP + user-agent); the raw IP and user-agent are **not** stored. Locale + optional kiosk code at vote time.
- **Purposes:** rank the public "most-loved plants" leaderboard and deduplicate votes (one vote per visitor per plant).
- **Legal basis:** Art. 6(1)(f) legitimate interest — a lightweight, pseudonymous popularity signal; no profiling.
- **Specifics:** stored pseudonymously; the hash cannot be linked to a donor account and is not reversible to the IP without the original inputs. Note the hash is **coarse** — visitors sharing a network/browser (e.g. the garden Wi-Fi, a shared kiosk) collapse to one, which under-counts rather than over-identifies.

---

## 2. Necessity + proportionality

| Activity | Could we do without? | Proportionate? |
|---|---|---|
| Email + name | No — the donor needs the receipt; Finnish tax law requires the donor be identifiable on the receipt for amounts that qualify under TVL §57. | Yes, minimum necessary. |
| Postal address | Only when a reward is posted. Optional otherwise. | Yes — collected only when needed. |
| Payment data | Handled by the University donation channel; BloomOulu stores only the donation record + payment reference, not card data. | Yes — minimum necessary on our side. |
| Favourite votes (visitorHash) | Needed to dedupe votes + rank the leaderboard without requiring accounts. | Yes — a pseudonymous hash, no raw IP stored, no profiling. |
| AskTheGarden chat text retention | Could anonymise sooner; we retain 12 months for quality eval. | Yes — pseudonymisation at month 12; donor can erase any time. |
| Audit log | Required for finance audit + compliance investigation. | Yes — content scoped to action + resource, not full PII. |

---

## 3. Risks to data subjects

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| **Data breach** of donor PII + payment metadata | Low | High | TLS at the edge (Caddy + Let's Encrypt); encryption at rest (Postgres + MinIO server-side encryption); secrets via Doppler / SOPS; daily encrypted backups; pen test before launch + annually. |
| **AI hallucination** misleading a donor about a plant's care | Medium | Low–Medium | Citation enforcement; score-floor short-circuit to escalation card; curator-reviewed corpus; quarterly RAG eval; "off base" feedback button on every answer. |
| **Pseudonymisation insufficient** post-erasure | Low | Medium | Audit log retention is documented as a legal-basis tradeoff in the privacy policy; donor is informed before erasure proceeds. SHA-256 of email-localpart is sufficient against re-identification at our scale. |
| **Third-party transfer to non-EEA** | Low | Medium | Donations run through the University donation channel and AI through University-hosted Lehmus AI — both **within the EEA**, so no donor PII leaves the EEA. Plant-*catalogue* enrichment may query non-EEA open-data sources, but carries no personal data. Re-verify if a web-search fallback or a non-EEA payment sub-processor is later introduced. |
| **Kiosk capturing bystanders** via inadvertent camera/microphone access | Low | High | Kiosk hardware has no camera or microphone enabled; Chromium kiosk profile blocks `getUserMedia`. |
| **Profiling** of donor for ad targeting | Not applicable | — | We don't profile; no ads. |

---

## 4. Residual risk

Residual risk is **LOW** under normal operation. The combination of:

- EU-only data residency
- Self-hosted infrastructure (no SaaS exfiltration vector)
- Idempotent payments + reconciliation (no silent state drift)
- Audit log inside every business transaction
- Daily encrypted backups + tested restore drill (target RTO ≤ 30 min)
- External pen test + WCAG audit prior to launch
- ntfy.sh alerting to ops phones for P0 incidents

...keeps residual risk acceptable for the data volume (year-1 projection ≤ 200 donors, ≤ 50k chat messages, ≤ 10k kiosk events).

---

## 5. Consultation

- **University of Oulu DPO:** TBD — sign-off required before isPublished on the production ContentBlock rows.
- **Data subjects:** privacy policy is available on every page footer; we provide a feedback channel via accessibility@bloomoulu.fi for the accessibility statement, and dpo@oulu.fi for privacy questions.
- **Tietosuojavaltuutettu (Finnish DPA):** no prior consultation required given residual-risk assessment LOW. Notification + DPIA filing available on request.

---

## 6. Sign-off

| Role | Name | Date | Notes |
|---|---|---|---|
| Engineering lead | Hassan Patwary | 2026-05-14 | Engineering review complete. |
| University DPO | _pending_ | _pending_ | |
| Garden director | _pending_ | _pending_ | |
| Legal counsel | _pending_ | _pending_ | |

**Next review:** annually, or sooner if any of the following changes: payment providers added/removed, AskTheGarden model swap, new data category collected, breach.
