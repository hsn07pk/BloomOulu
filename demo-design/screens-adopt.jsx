// Adopt flow — tier ladder → checkout

const AdoptScreen = ({ presetPlantId, onNav }) => {
  const { t, lang } = useT();
  const [step, setStep] = React.useState(1);
  const [tierId, setTierId] = React.useState("vulnerable");
  const [plantId, setPlantId] = React.useState(presetPlantId || "puls-pat");
  const [recurring, setRecurring] = React.useState(false);
  const [isGift, setIsGift] = React.useState(false);
  const [intent, setIntent] = React.useState("self"); // self / gift / memorial / class
  const [pay, setPay] = React.useState("mobilepay");
  const [dedication, setDedication] = React.useState("");

  const tierRaw = TIERS.find(tr => tr.id === tierId);
  const tier = localiseTier(tierRaw, lang);
  const plants = React.useMemo(() => PLANTS.map(p => localisePlant(p, lang)), [lang]);
  const tiers = React.useMemo(() => TIERS.map(tier => localiseTier(tier, lang)), [lang]);
  const plant = plants.find(p => p.id === plantId);
  const total = recurring ? tier.monthly : tier.price;

  return (
    <div className="fade-in">
      {/* Progress bar */}
      <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line-soft)", position: "sticky", top: 65, zIndex: 30 }}>
        <div className="container" style={{ padding: "16px 32px", display: "flex", alignItems: "center", gap: 24 }}>
          <button className="btn btn-ghost small" onClick={() => step > 1 ? setStep(step - 1) : onNav("discover")}>
            <Icon name="back" size={14}/> {step === 1 ? t("Back to garden") : t("Previous")}
          </button>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1, justifyContent: "center" }}>
            {[ t("Choose tier") , t("Pick plant") , t("Personalise") , t("Pay")].map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              return (
                <React.Fragment key={n}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: done ? "var(--forest)" : active ? "var(--rust)" : "rgba(31,58,44,0.08)",
                      color: done || active ? "var(--paper)" : "var(--ink-3)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 600
                    }}>{done ? <Icon name="check" size={12}/> : n}</div>
                    <span className="small" style={{ color: active ? "var(--ink)" : "var(--ink-3)", fontWeight: active ? 500 : 400 }}>{label}</span>
                  </div>
                  {n < 4 && <div style={{ width: 40, height: 1, background: "var(--line)" }}/>}
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ width: 100 }}/>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        {step === 1 && (
          <div className="fade-in">
            <div style={{ marginBottom: 40 }}>
              <div className="tiny" style={{ color: "var(--rust)" }}>{t("Step 1 of 4")}</div>
              <h1 style={{ fontSize: 56, marginTop: 12 }}>{t("Choose your tier")}</h1>
            </div>

            {/* Recurring toggle */}
            <div style={{ display: "inline-flex", padding: 4, background: "var(--paper)", borderRadius: 999, marginBottom: 28 }}>
              <button onClick={() => setRecurring(false)} className="pill" style={{ padding: "8px 18px", background: !recurring ? "var(--forest)" : "transparent", color: !recurring ? "var(--paper)" : "var(--ink-2)" }}>{t("One-off")}</button>
              <button onClick={() => setRecurring(true)} className="pill" style={{ padding: "8px 18px", background: recurring ? "var(--forest)" : "transparent", color: recurring ? "var(--paper)" : "var(--ink-2)" }}>{t("Monthly · 5–10× retention")}</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {tiers.map(tier => (
                <button key={tier.id} onClick={() => setTierId(tier.id)} className="card" style={{
                  padding: 0,
                  textAlign: "left",
                  border: tierId === tier.id ? `2px solid ${tier.color}` : "1px solid var(--line-soft)",
                  overflow: "hidden",
                  transition: "all 200ms",
                  transform: tierId === tier.id ? "translateY(-4px)" : "none",
                  boxShadow: tierId === tier.id ? "var(--shadow-lg)" : "none"
                }}>
                  <div style={{ padding: "20px 24px 24px", background: tier.bg, position: "relative" }}>
                    {tier.tag && <div className="badge" style={{ background: "rgba(255,255,255,0.7)", color: "var(--ink-2)", position: "absolute", top: 16, right: 16 }}>{tier.tag}</div>}
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: tier.color, display: "flex", alignItems: "center", justifyContent: "center", color: "white", marginBottom: 20 }}>
                      <Icon name="seedling" size={18}/>
                    </div>
                    <div className="tiny">{tier.fi}</div>
                    <div className="serif" style={{ fontSize: 28, marginTop: 4 }}>{tier.name}</div>
                    <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span className="serif" style={{ fontSize: 44 }}>€{recurring ? tier.monthly : tier.price}</span>
                      <span className="muted small">{recurring ? t("/month") : t("one-off")}</span>
                    </div>
                    {recurring && <div className="tiny" style={{ marginTop: 4 }}>= €{(tier.monthly * 12).toFixed(0)} / {t("year")}</div>}
                  </div>
                  <div style={{ padding: 20 }}>
                    <div className="small muted" style={{ marginBottom: 14, lineHeight: 1.5 }}>{tier.blurb}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {tier.perks.map(p => (
                        <div key={p} style={{ display: "flex", gap: 8, alignItems: "start", fontSize: 13 }}>
                          <Icon name="check" size={13} style={{ color: tier.color, marginTop: 3, flexShrink: 0 }}/>
                          <span>{p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Corporate tier strip */}
            <div className="card" style={{ marginTop: 32, padding: 0, overflow: "hidden", background: "var(--forest)", color: "var(--paper)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 0 }}>
                <div style={{ padding: 32 }}>
                  <div className="tiny" style={{ color: "var(--lichen)" }}>{t("Yritys · Corporate")}</div>
                  <h3 className="serif" style={{ fontSize: 32, marginTop: 8, color: "var(--paper)" }}>{t("For companies")}</h3>
                  <p className="small" style={{ marginTop: 12, color: "rgba(248,244,230,0.7)", lineHeight: 1.5 }}>
                    {t("CSR-ready quarterly impact reports, logo placement, employee tours. Tax-deductible under TVL §57 for Finnish corporates.")}
                  </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderLeft: "1px solid rgba(248,244,230,0.15)" }}>
                  {CORPORATE_TIERS.map((c, i) => (
                    <div key={c.name} style={{ padding: 24, borderRight: i < 2 ? "1px solid rgba(248,244,230,0.15)" : "none" }}>
                      <div className="tiny" style={{ color: "var(--lichen)" }}>{c.name}</div>
                      <div className="serif" style={{ fontSize: 32, marginTop: 8, color: "var(--paper)" }}>€{c.price.toLocaleString()}<span style={{ fontSize: 14, color: "rgba(248,244,230,0.6)" }}>/yr</span></div>
                      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                        {c.perks.map(p => (
                          <div key={p} style={{ display: "flex", gap: 6, alignItems: "start", fontSize: 12, color: "rgba(248,244,230,0.8)" }}>
                            <Icon name="check" size={11} style={{ color: "var(--lichen)", marginTop: 3, flexShrink: 0 }}/>
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "end", marginTop: 32 }}>
              <button className="btn btn-primary btn-lg" onClick={() => setStep(2)}>
                {t("Continue with")} {tier.name} · €{total}{recurring ? "/mo" : ""} <Icon name="arrow" size={16}/>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div style={{ marginBottom: 40, display: "flex", justifyContent: "space-between", alignItems: "end" }}>
              <div>
                <div className="tiny" style={{ color: "var(--rust)" }}>{t("Step 2 of 4")}</div>
                <h1 style={{ fontSize: 56, marginTop: 12 }}>{t("Pick a plant")}</h1>
                <p className="muted" style={{ marginTop: 12, maxWidth: 600 }}>{t("Some plants are nearly fully funded — co-adopt anyway, or pick one that needs you more.")}</p>
              </div>
              <span className="pill"><Icon name="seedling" size={13}/> {tier.name} tier · €{total}{recurring ? "/mo" : ""}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {plants.map(p => {
                const selected = plantId === p.id;
                const needs = p.funded < 80;
                return (
                  <button key={p.id} onClick={() => setPlantId(p.id)} className="card" style={{
                    padding: 0, overflow: "hidden", textAlign: "left",
                    border: selected ? `2px solid ${tier.color}` : "1px solid var(--line-soft)",
                    transform: selected ? "translateY(-4px)" : "none",
                    boxShadow: selected ? "var(--shadow-lg)" : "var(--shadow-sm)",
                    transition: "all 200ms"
                  }}>
                    <div style={{ height: 140, background: p.accent, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Botanical color={p.color} accent={p.accent} variant={p.variant} style={{ width: "70%", height: "85%" }}/>
                      {needs && <div className="badge" style={{ background: "var(--rust)", color: "var(--paper)", position: "absolute", top: 10, left: 10 }}>{t("Needs adopters")}</div>}
                      {selected && <div style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: "50%", background: tier.color, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={14}/></div>}
                    </div>
                    <div style={{ padding: 14 }}>
                      <div className="serif" style={{ fontSize: 17, fontStyle: "italic", lineHeight: 1.1 }}>{p.name}</div>
                      <div className="tiny" style={{ marginTop: 4 }}>{p.rarity} · {p.adopters} adopters</div>
                      <div style={{ marginTop: 10 }}>
                        <Progress pct={p.funded} color={p.color} height={3}/>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "end", marginTop: 32 }}>
              <button className="btn btn-primary btn-lg" onClick={() => setStep(3)}>
                {t("Continue with")} <i style={{ marginLeft: 4, marginRight: 4 }}>{plant.name}</i> <Icon name="arrow" size={16}/>
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="fade-in">
            <div style={{ marginBottom: 40 }}>
              <div className="tiny" style={{ color: "var(--rust)" }}>{t("Step 3 of 4")}</div>
              <h1 style={{ fontSize: 56, marginTop: 12 }}>{t("Personalise")}</h1>
              <p className="muted" style={{ marginTop: 12, maxWidth: 600 }}>{t("For yourself, a friend's birthday, in someone's memory, or for your class.")}</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40 }}>
              <div className="col" style={{ gap: 24 }}>
                {/* Intent picker */}
                <div className="card card-pad">
                  <div className="tiny">{t("This adoption is")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
                    {[
                      { id: "self", label: t("For me"), icon: "user" },
                      { id: "gift", label: t("A gift"), icon: "gift" },
                      { id: "memorial", label: t("In memoriam"), icon: "heart" },
                      { id: "class", label: t("Class / school"), icon: "school" }
                    ].map(opt => (
                      <button key={opt.id} onClick={() => setIntent(opt.id)} style={{
                        padding: 14, borderRadius: 12, border: `1px solid ${intent === opt.id ? "var(--forest)" : "var(--line)"}`,
                        background: intent === opt.id ? "rgba(31,58,44,0.05)" : "var(--paper)",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                        cursor: "pointer", color: "var(--ink)"
                      }}>
                        <Icon name={opt.icon} size={20} style={{ color: intent === opt.id ? "var(--forest)" : "var(--ink-3)" }}/>
                        <span className="small" style={{ fontWeight: intent === opt.id ? 600 : 400 }}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Adopter info */}
                <div className="card card-pad">
                  <div className="tiny">{intent === "gift" ? t("From you") : t("Adopter details")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                    <Field label={t("Name on certificate")} placeholder="Mira Karjalainen"/>
                    <Field label={t("Email")} placeholder="mira@example.fi"/>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <Field label={intent === "memorial" ? t("Dedication (e.g. In memory of…)") : t("Public dedication (shown on plant page, optional)")} placeholder={intent === "memorial" ? "In memory of Eeva — who loved the lady's-slipper." : "From Mira, summer 2026 🌱"} value={dedication} onChange={setDedication} maxLength={80}/>
                    <div className="tiny" style={{ marginTop: 6, textAlign: "right" }}>{dedication.length}/80</div>
                  </div>
                </div>

                {/* Gift-specific */}
                {intent === "gift" && (
                  <div className="card card-pad" style={{ background: "linear-gradient(135deg, #fbf3e0 0%, #f4eccc 100%)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Icon name="gift" size={18} style={{ color: "var(--rust)" }}/>
                      <div className="tiny" style={{ color: "var(--rust)" }}>{t("Gift delivery")}</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                      <Field label={t("Recipient name")} placeholder="Aino" />
                      <Field label={t("Recipient email")} placeholder="aino@example.fi" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                      <Field label={t("Deliver on")} type="date" defaultValue="2026-06-21"/>
                      <Field label={t("Send anonymously?")} type="select" options={[ t("No, sign from me") , t("Yes, anonymous") ]}/>
                    </div>
                    <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, padding: 12, background: "rgba(255,255,255,0.6)", borderRadius: 10, cursor: "pointer" }}>
                      <input type="checkbox" defaultChecked style={{ accentColor: "var(--rust)" }}/>
                      <div>
                        <div className="small" style={{ fontWeight: 500 }}>{t("Gift-wrap upgrade · €4")}</div>
                        <div className="tiny" style={{ textTransform: "none", fontFamily: "Geist", letterSpacing: 0 }}>{t("Printed certificate on linen card stock, mailed to recipient")}</div>
                      </div>
                    </label>
                  </div>
                )}

                {/* Memorial-specific */}
                {intent === "memorial" && (
                  <div className="card card-pad" style={{ background: "rgba(107, 45, 58, 0.04)", borderColor: "rgba(107,45,58,0.2)" }}>
                    <div className="tiny" style={{ color: "var(--berry)" }}>{t("Memorial details")}</div>
                    <p className="small" style={{ marginTop: 8, color: "var(--ink-2)" }}>{t("Plaque-text remains on the plant page for 5 years. We'll email a chosen family member each spring on the bloom anniversary.")}</p>
                    <div style={{ marginTop: 16 }}>
                      <Field label={t("Family recipient email")} placeholder="family@example.fi"/>
                    </div>
                  </div>
                )}

                {/* Co-adopt */}
                <div className="card card-pad" style={{ background: "var(--paper)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div className="small" style={{ fontWeight: 500 }}>{t("Co-adopt with friends or family")}</div>
                      <div className="tiny" style={{ textTransform: "none", fontFamily: "Geist", letterSpacing: 0, marginTop: 2 }}>{t("Split the gift; everyone gets named on the plant page.")}</div>
                    </div>
                    <button className="btn btn-secondary small">{t("+ Add co-adopter")}</button>
                  </div>
                </div>
              </div>

              {/* Summary panel */}
              <div style={{ position: "sticky", top: 140, alignSelf: "start" }}>
                <SummaryCard plant={plant} tier={tier} recurring={recurring} intent={intent} total={total} dedication={dedication}/>
                <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} onClick={() => setStep(4)}>
                  {t("Continue to payment")} <Icon name="arrow" size={16}/>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="fade-in">
            <div style={{ marginBottom: 40 }}>
              <div className="tiny" style={{ color: "var(--rust)" }}>{t("Step 4 of 4")}</div>
              <h1 style={{ fontSize: 56, marginTop: 12 }}>{t("Payment")}</h1>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40 }}>
              <div className="col" style={{ gap: 16 }}>
                {/* Pay methods */}
                <div className="card card-pad">
                  <div className="tiny">{t("Payment method")}</div>
                  <div className="col" style={{ marginTop: 12, gap: 10 }}>
                    {[
                      { id: "mobilepay", label: t("MobilePay"), sub: t("Most popular in Finland · 12657"), logo: <div style={{ background: "#5A78FF", color: "white", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700 }}>MP</div> },
                      { id: "card", label: t("Card"), sub: t("Visa / Mastercard via Stripe"), logo: <div style={{ display: "flex", gap: 4 }}><div style={{ background: "#1A1F71", color: "white", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>VISA</div><div style={{ background: "#EB001B", color: "white", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>MC</div></div> },
                      { id: "invoice", label: t("Invoice (corporate)"), sub: t("Net 30 · VAT-handled"), logo: <Icon name="building" size={18}/> },
                      { id: "bank", label: t("Bank transfer"), sub: "FI21 1234 5678 9012 34", logo: <Icon name="info" size={18}/> }
                    ].map(m => (
                      <label key={m.id} style={{
                        display: "flex", gap: 14, padding: 16, borderRadius: 12,
                        border: `1px solid ${pay === m.id ? "var(--forest)" : "var(--line)"}`,
                        background: pay === m.id ? "rgba(31,58,44,0.04)" : "var(--paper)",
                        cursor: "pointer", alignItems: "center"
                      }}>
                        <input type="radio" checked={pay === m.id} onChange={() => setPay(m.id)} style={{ accentColor: "var(--forest)" }}/>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500 }}>{m.label}</div>
                          <div className="small muted">{m.sub}</div>
                        </div>
                        {m.logo}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Card form */}
                {pay === "card" && (
                  <div className="card card-pad">
                    <div className="tiny">{t("Card details")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
                      <Field label={t("Card number")} placeholder="4242 4242 4242 4242"/>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                        <Field label={t("Expiry")} placeholder="MM / YY"/>
                        <Field label={t("CVC")} placeholder="123"/>
                        <Field label={t("Postal code")} placeholder="90014"/>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tax disclosure */}
                <div style={{ padding: 16, background: "rgba(31,58,44,0.04)", borderRadius: 12, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
                  <Icon name="info" size={14} style={{ verticalAlign: "middle", marginRight: 6, color: "var(--forest)" }}/>
                  Of €{total}, €{Math.round(total * 0.72)} is treated as a donation (no VAT); €{Math.round(total * 0.28)} covers benefits (24% VAT applied). This gift may be tax-deductible for Finnish companies under TVL §57. <a href="#" style={{ color: "var(--forest)" }}>Read the funds-flow policy</a>.
                </div>

                <label style={{ display: "flex", gap: 10, alignItems: "start", padding: 14 }}>
                  <input type="checkbox" style={{ accentColor: "var(--forest)", marginTop: 3 }}/>
                  <span className="small">{t("I'd like quarterly email updates about my plant and the Garden's conservation work. Max 2/month, no third parties (GDPR-compliant).")}</span>
                </label>
              </div>

              <div style={{ position: "sticky", top: 140, alignSelf: "start" }}>
                <SummaryCard plant={plant} tier={tier} recurring={recurring} intent={intent} total={total} dedication={dedication}/>
                <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} onClick={() => onNav("garden")}>
                  <Icon name="check" size={16}/> Confirm · pay €{total}{recurring ? "/mo" : ""}
                </button>
                <div className="tiny" style={{ textAlign: "center", marginTop: 12, textTransform: "none", letterSpacing: 0, fontFamily: "Geist" }}>
                  {t("Donations non-refundable except for technical errors.")}<br/>
                  {t("Plant-died policy: replacement in year 1, transfer to equal/higher rarity in years 2+.")}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, placeholder, type = "text", value, onChange, defaultValue, maxLength, options }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span className="tiny" style={{ textTransform: "none", letterSpacing: 0, fontFamily: "Geist", color: "var(--ink-3)" }}>{label}</span>
    {type === "select" ? (
      <select defaultValue={defaultValue} style={fieldStyle}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    ) : (
      <input type={type} placeholder={placeholder} value={value} defaultValue={defaultValue} maxLength={maxLength} onChange={onChange ? e => onChange(e.target.value) : undefined} style={fieldStyle}/>
    )}
  </label>
);
const fieldStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--paper)",
  fontSize: 14,
  fontFamily: "Geist",
  color: "var(--ink)",
  outline: "none"
};

const SummaryCard = ({ plant, tier, recurring, intent, total, dedication }) => {
  const { t } = useT();
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: 24, background: "var(--paper)", borderBottom: "1px solid var(--line-soft)" }}>
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ width: 60, height: 76, borderRadius: 10, background: plant.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Botanical color={plant.color} accent={plant.accent} variant={plant.variant} style={{ width: 48, height: 64 }}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tiny">{plant.fi}</div>
            <div className="serif" style={{ fontSize: 22, fontStyle: "italic", lineHeight: 1.1, marginTop: 2 }}>{plant.name}</div>
            <div style={{ marginTop: 6 }}><RarityBadge rarity={plant.rarity} label={plant.rarityLabel}/></div>
          </div>
        </div>
      </div>
      <div style={{ padding: 24 }}>
        <Row label={`${tier.name} tier`} value={`€${recurring ? tier.monthly : tier.price}${recurring ? "/mo" : ""}`}/>
        <Row label={t("Intent")} value={{ self: t("Personal"), gift: t("Gift"), memorial: t("Memorial (5-yr)"), class: t("Class / School") }[intent]}/>
        {dedication && <Row label={t("Dedication")} value={`"${dedication.slice(0, 30)}${dedication.length > 30 ? "…" : ""}"`}/>}
        <Row label={t("Billing")} value={recurring ? t("Monthly · cancel anytime") : t("One-off")}/>
        <div style={{ borderTop: "1px dashed var(--line)", margin: "16px 0" }}/>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontWeight: 500 }}>{t("Total today")}</div>
          <div className="serif" style={{ fontSize: 32 }}>€{total}{recurring ? <span style={{ fontSize: 14, color: "var(--ink-3)" }}>/mo</span> : ""}</div>
        </div>
      </div>
    </div>
  );
};

const Row = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
    <span className="muted">{label}</span>
    <span style={{ fontWeight: 500 }}>{value}</span>
  </div>
);

window.AdoptScreen = AdoptScreen;
