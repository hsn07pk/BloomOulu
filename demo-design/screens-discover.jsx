// Discover screen - homepage with hero, what's blooming, plant grid, conservation story

const DiscoverScreen = ({ onOpenPlant, onNav }) => {
  const { t, lang } = useT();
  const filterOptions = [
    { id: t("All"), label: t("All") },
    { id: "CR", label: t("Critically Endangered") },
    { id: "EN", label: t("Endangered") },
    { id: "VU", label: t("Vulnerable") },
    { id: "NT", label: t("Near Threatened") },
    { id: "NA", label: t("Greenhouse Star") }
  ];
  const [filter, setFilter] = React.useState("All");
  const plants = React.useMemo(() => PLANTS.map(p => localisePlant(p, lang)), [lang]);
  const visible = plants.filter(p => filter === "All" || p.rarity === filter);

  return (
    <div className="fade-in">
      {/* HERO */}
      <section style={{ background: "var(--forest)", color: "var(--paper)", position: "relative", overflow: "hidden" }} className="grain">
        <div className="container" style={{ paddingTop: 56, paddingBottom: 72, position: "relative", zIndex: 2 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 56, alignItems: "end" }}>
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
                <span className="pill pill-on-dark"><Icon name="leaf" size={13}/> {t("University of Oulu Botanical Garden")}</span>
                <span className="pill pill-on-dark"><Icon name="map" size={13}/> {t("65°N · Northernmost scientific garden")}</span>
              </div>
              <h1 style={{ fontSize: 92, color: "var(--paper)", lineHeight: 0.95 }}>
                {t("Adopt a plant.")}<br/>
                <span style={{ fontStyle: "italic", color: "var(--lichen)" }}>{t("Keep Finland in bloom.")}</span>
              </h1>
              <p style={{ marginTop: 28, fontSize: 18, color: "rgba(248,244,230,0.78)", maxWidth: 540, lineHeight: 1.5 }}>
                {t("Of 2,667 species on Finland's Red List, 175 live ex situ in this garden. Sponsor one - name it, follow it, watch it flower. Or just say hi to it through the QR code on its label.")}
              </p>
              <div style={{ marginTop: 36, display: "flex", gap: 12, alignItems: "center" }}>
                <button className="btn btn-lg" style={{ background: "var(--rust)", color: "var(--paper)" }} onClick={() => onNav("adopt")}>
                  <Icon name="seedling" size={18}/> {t("Adopt a plant from €25")}
                </button>
                <button className="btn btn-lg btn-ghost" style={{ color: "var(--paper)", border: "1px solid rgba(248,244,230,0.3)" }} onClick={() => onNav("ask")}>
                  <Icon name="bot" size={18}/> {t("Ask the Garden")}
                </button>
              </div>

              {/* Stat strip */}
              <div data-grid-mobile="2" style={{ marginTop: 64, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderTop: "1px solid rgba(248,244,230,0.18)", paddingTop: 28 }}>
                {[
                  ["4 000+", t("plant species") ],
                  ["175", t("threatened taxa ex situ") ],
                  ["1.7M", t("seeds banked (LIFE+ ESCAPE)") ],
                  ["56 %", t("ex-situ coverage achieved") ]
                ].map(([n, l]) => (
                  <div key={l} style={{ paddingRight: 16 }}>
                    <div className="serif" style={{ fontSize: 36, color: "var(--lichen)", letterSpacing: "-0.02em" }}>{n}</div>
                    <div className="small" style={{ color: "rgba(248,244,230,0.6)", marginTop: 4 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right column - what's blooming card */}
            <div className="card" style={{ background: "var(--paper)", padding: 0, overflow: "hidden", borderRadius: 24 }}>
              <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="tiny">{t("This week in the garden")}</div>
                  <div className="serif" style={{ fontSize: 22, color: "var(--ink)", marginTop: 2 }}>{t("What's blooming")}</div>
                </div>
                <span className="pill"><Icon name="sun" size={13}/> {t("12 °C · partly sun")}</span>
              </div>
              {plants.slice(0, 3).map((p, i) => (
                <button key={p.id} onClick={() => onOpenPlant(p.id)} style={{ display: "flex", gap: 14, padding: "16px 24px", width: "100%", textAlign: "left", borderBottom: i < 2 ? "1px solid var(--line-soft)" : "none", alignItems: "center" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 12, background: p.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Botanical color={p.color} accent={p.accent} variant={p.variant} style={{ width: 44, height: 56 }}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="serif" style={{ fontSize: 18, color: "var(--ink)" }}>{p.name}</div>
                    <div className="small muted" style={{ marginTop: 2 }}>{p.fi} · {t(p.bloom)}</div>
                  </div>
                  <Icon name="arrow" size={16} style={{ color: "var(--ink-3)" }}/>
                </button>
              ))}
              <div style={{ padding: "14px 24px", background: "rgba(31,58,44,0.04)", textAlign: "center" }}>
                <button className="btn btn-ghost small" onClick={() => onNav("kiosk")}><Icon name="building" size={14}/> {t("Open the lobby kiosk view")}</button>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative botanical sketch */}
        <svg style={{ position: "absolute", right: -120, top: -40, opacity: 0.08, width: 600, height: 600 }} viewBox="0 0 200 200" stroke="white" fill="none" strokeWidth="0.5">
          <g transform="translate(100, 180)">
            <path d="M0 0 V-180"/>
            {[20, 50, 80, 110, 140].flatMap((y, i) => [
              <path key={`l${i}`} d={`M0 -${y} Q-${30+i*4} -${y+15} -${50+i*6} -${y}`}/>,
              <path key={`r${i}`} d={`M0 -${y} Q${30+i*4} -${y+15} ${50+i*6} -${y}`}/>
            ])}
          </g>
        </svg>
      </section>

      {/* PLANT INDEX */}
      <section className="container" style={{ paddingTop: 64, paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <div className="tiny" style={{ color: "var(--rust)" }}>{t("The collection · 4 213 specimens")}</div>
            <h2 style={{ fontSize: 52, marginTop: 8 }}>{t("Browse the living index")}</h2>
            <p className="muted" style={{ marginTop: 12, maxWidth: 520 }}>{t("Every plant in the outdoor garden and the Romeo & Julia greenhouses has its own page, its own audio narration, and - for many - a sponsorship invitation.")}</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <input placeholder={t("Search 4 213 plants…")} style={{ padding: "12px 16px 12px 40px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--paper)", width: 280, fontSize: 14, color: "var(--ink)" }}/>
              <Icon name="search" size={16} style={{ position: "absolute", left: 14, top: 13, color: "var(--ink-3)" }}/>
            </div>
            <button className="icon-btn"><Icon name="qr" size={16}/></button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 32 }}>
          {filterOptions.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className="pill" style={{
              cursor: "pointer",
              background: filter === f.id ? "var(--forest)" : "rgba(31,58,44,0.06)",
              color: filter === f.id ? "var(--paper)" : "var(--ink-2)",
              padding: "8px 16px",
              fontSize: 13
            }}>
              {f.id === "CR" && <span style={{ width: 8, height: 8, borderRadius: 50, background: "#B8513A", display: "inline-block" }}/>}
              {f.id === "EN" && <span style={{ width: 8, height: 8, borderRadius: 50, background: "#C77E45", display: "inline-block" }}/>}
              {f.id === "VU" && <span style={{ width: 8, height: 8, borderRadius: 50, background: "#C19A3D", display: "inline-block" }}/>}
              {f.label}
            </button>
          ))}
        </div>

        <div data-grid-mobile="2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
          {visible.map(p => (
            <button key={p.id} onClick={() => onOpenPlant(p.id)} className="card" style={{ padding: 0, overflow: "hidden", textAlign: "left", transition: "all 200ms", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "var(--shadow-lg)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = ""; }}>
              <div style={{ height: 220, background: p.accent, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Botanical color={p.color} accent={p.accent} variant={p.variant} style={{ width: "70%", height: "90%" }}/>
                <div style={{ position: "absolute", top: 14, left: 14 }}>
                  <RarityBadge rarity={p.rarity} label={p.rarityLabel} compact/>
                </div>
                <div style={{ position: "absolute", top: 14, right: 14, padding: "4px 10px", background: "rgba(255,255,255,0.85)", borderRadius: 999, fontSize: 11, fontFamily: "Geist Mono", color: "var(--ink-2)" }}>
                  {p.accession}
                </div>
                <div style={{ position: "absolute", bottom: 14, left: 14, display: "flex", gap: 6, alignItems: "center", background: "rgba(255,255,255,0.85)", padding: "5px 12px", borderRadius: 999, fontSize: 12 }}>
                  <Icon name="play" size={11}/> {p.audio}
                </div>
              </div>
              <div style={{ padding: 18 }}>
                <div className="serif" style={{ fontSize: 22, color: "var(--ink)", fontStyle: "italic", lineHeight: 1.05 }}>{p.name}</div>
                <div className="small muted" style={{ marginTop: 4 }}>{p.fi} · {p.en}</div>
                <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div className="tiny">{t("Adopters")}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{p.adopters}</div>
                  </div>
                  <div style={{ flex: 1, marginLeft: 16 }}>
                    <Progress pct={p.funded} color={p.color}/>
                    <div className="tiny" style={{ marginTop: 4, textAlign: "right" }}>{p.funded}% {t("funded")}</div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* CONSERVATION STORY BAND */}
      <section style={{ background: "var(--paper)", borderTop: "1px solid var(--line-soft)", borderBottom: "1px solid var(--line-soft)", marginTop: 64 }}>
        <div className="container" style={{ paddingTop: 64, paddingBottom: 64, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
          <div>
            <div className="tiny" style={{ color: "var(--rust)" }}>{t("The conservation story")}</div>
            <h2 style={{ fontSize: 48, marginTop: 12 }}>{t("From 11 % to 56 %.")}<br/><span style={{ fontStyle: "italic" }}>{t("A measurable national project.")}</span></h2>
            <p className="muted" style={{ marginTop: 20, fontSize: 16, lineHeight: 1.6, maxWidth: 480 }}>
              {t("Between 2012 and 2017, the LIFE+ ESCAPE programme lifted ex-situ coverage of Finland's threatened plants from 11% to 56%, banked 1.7 million seeds across 175 taxa, and seeded the Finnish national gene bank with 148 species. Oulu was a partner garden then. Adoption funds the next chapter.")}
            </p>
            <button className="btn btn-secondary" style={{ marginTop: 28 }}><Icon name="info" size={14}/> {t("Read where your money goes")}</button>
          </div>
          <div className="card card-pad" style={{ background: "var(--bg)", borderRadius: 24 }}>
            <div className="tiny">{t("Of every €100 adopted")}</div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                [ t("Direct ex-situ work") , 62, "var(--forest)"],
                [ t("Seed bank deposits (Luomus)") , 18, "var(--moss)"],
                [ t("Garden operations & signage") , 12, "var(--bloom)"],
                [ t("Payment & platform costs") , 8, "var(--ink-3)"]
              ].map(([label, pct, color]) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="small">{label}</span>
                    <span className="serif" style={{ fontSize: 18 }}>€{pct}</span>
                  </div>
                  <Progress pct={pct} color={color} height={4}/>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, padding: 16, background: "var(--paper)", borderRadius: 12, fontSize: 13, color: "var(--ink-2)" }}>
              <Icon name="info" size={13} style={{ color: "var(--rust)", verticalAlign: "middle", marginRight: 4 }}/>
              <span className="muted">{t("Audited annually; transparent funds-flow page published every January.")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* JOURNEY STRIP */}
      <section className="container" style={{ paddingTop: 64, paddingBottom: 80 }}>
        <div className="tiny" style={{ color: "var(--rust)" }}>{t("How BloomOulu works")}</div>
        <h2 style={{ fontSize: 48, marginTop: 12, marginBottom: 40 }}>{t("Scan · Ask · Adopt · Return")}</h2>
        <div data-grid-mobile="2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
          {[
            { num: "01", icon: "qr", title: t("Scan a plant"), body: t("Every label has a QR - and an NFC tag for blind visitors. Tap or scan, get 30-second audio in Finnish, Swedish, or English.") },
            { num: "02", icon: "bot", title: t("Ask the Garden"), body: t("Our AI is grounded in the Garden's accession database and the Biodiversity Unit's publications. Every answer cites its source.") },
            { num: "03", icon: "seedling", title: t("Adopt"), body: t("From €25 for a digital certificate to €500 for an engraved plaque. Gift-flow first-class. Memorial adoptions supported.") },
            { num: "04", icon: "bell", title: t("Return"), body: t("When your plant flowers, we email you. Adopters' Day in June. Winter mode shows your dormant friend under the snow.") }
          ].map(step => (
            <div key={step.num} className="card card-pad" style={{ position: "relative" }}>
              <div className="tiny" style={{ color: "var(--rust)" }}>{step.num}</div>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(31,58,44,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--forest)", marginTop: 16, marginBottom: 16 }}>
                <Icon name={step.icon} size={20}/>
              </div>
              <div className="serif" style={{ fontSize: 24 }}>{step.title}</div>
              <p className="muted small" style={{ marginTop: 10, lineHeight: 1.6 }}>{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

window.DiscoverScreen = DiscoverScreen;
