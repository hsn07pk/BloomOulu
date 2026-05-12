// Plant detail - the QR scan experience

const PlantScreen = ({ plantId, onBack, onNav, onAdopt }) => {
  const { t, lang } = useT();
  const plantRaw = PLANTS.find(p => p.id === plantId) || PLANTS[0];
  const plant = localisePlant(plantRaw, lang);
  const [audioPlaying, setAudioPlaying] = React.useState(false);
  const [audioProgress, setAudioProgress] = React.useState(0);
  const [tab, setTab] = React.useState("story");
  const [season, setSeason] = React.useState("summer");
  const [mode, setMode] = React.useState("adult");

  React.useEffect(() => {
    if (!audioPlaying) return;
    const t = setInterval(() => setAudioProgress(p => p >= 100 ? (setAudioPlaying(false), 0) : p + 1), 80);
    return () => clearInterval(t);
  }, [audioPlaying]);

  const seasons = [
    { id: "spring", label: t("Spring"), icon: "flower" },
    { id: "summer", label: t("Summer"), icon: "sun" },
    { id: "autumn", label: t("Autumn"), icon: "leaf" },
    { id: "winter", label: t("Winter"), icon: "snow" }
  ];

  return (
    <div className="fade-in">
      {/* Sticky back bar */}
      <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line-soft)", position: "sticky", top: 65, zIndex: 30 }}>
        <div className="container" style={{ padding: "14px 32px", display: "flex", alignItems: "center", gap: 16 }}>
          <button className="btn btn-ghost small" onClick={onBack}><Icon name="back" size={14}/> {t("Back")}</button>
          <span className="tiny">{t("Scanned via QR · ")}{plant.accession}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="icon-btn"><Icon name="bookmark" size={16}/></button>
            <button className="icon-btn"><Icon name="share" size={16}/></button>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 64, display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 48 }}>
        {/* LEFT - content */}
        <div>
          {/* Hero */}
          <div className="card" style={{ background: plant.accent, padding: 0, overflow: "hidden", borderRadius: 24, position: "relative", aspectRatio: "16/10" }}>
            <Botanical color={plant.color} accent={plant.accent} variant={plant.variant} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}/>
            <div style={{ position: "absolute", top: 20, left: 20, right: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <RarityBadge rarity={plant.rarity} label={plant.rarityLabel}/>
              <span className="badge" style={{ background: "rgba(255,255,255,0.7)", color: "var(--ink-2)" }}>{plant.family}</span>
            </div>
            <div style={{ position: "absolute", bottom: 20, left: 20, right: 20, display: "flex", alignItems: "end", justifyContent: "space-between" }}>
              <div style={{ background: "rgba(255,255,255,0.92)", padding: "12px 16px", borderRadius: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={() => setAudioPlaying(!audioPlaying)} className="btn btn-primary" style={{ width: 44, height: 44, padding: 0, borderRadius: "50%" }}>
                  <Icon name={audioPlaying ? "pause" : "play"} size={16}/>
                </button>
                <div style={{ minWidth: 180 }}>
                  <div className="tiny" style={{ color: "var(--ink-2)" }}>{t("Audio · Yle Radio Suomi voice")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <div style={{ flex: 1, height: 4, background: "rgba(31,58,44,0.12)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${audioProgress}%`, height: "100%", background: "var(--forest)" }}/>
                    </div>
                    <span className="mono small" style={{ color: "var(--ink-2)" }}>0:{(plant.audio || "1:30").split(":")[1]}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="icon-btn" style={{ background: "rgba(255,255,255,0.85)" }} title="Voice / TTS"><Icon name="mic" size={16}/></button>
              </div>
            </div>
          </div>

          {/* Title block */}
          <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "start", gap: 32 }}>
            <div>
              <div className="tiny" style={{ color: "var(--rust)" }}>{plant.fi} · {plant.sv}</div>
              <h1 className="serif" style={{ fontSize: 64, fontStyle: "italic", marginTop: 8, lineHeight: 1 }}>{plant.name}</h1>
              <div className="muted" style={{ marginTop: 12, fontSize: 16 }}>{plant.en} · {plant.family}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "end" }}>
              <div className="pill"><Icon name="map" size={13}/> {t(plant.origin)}</div>
              <div className="pill"><Icon name="calendar" size={13}/> {t("Blooms")} {t(plant.bloom)}</div>
            </div>
          </div>

          {/* Why this plant matters */}
          <div style={{ marginTop: 32, padding: "24px 28px", background: "var(--paper)", borderRadius: 18, borderLeft: `3px solid ${plant.color}` }}>
            <Icon name="quote" size={16} style={{ color: plant.color }}/>
            <p className="serif" style={{ fontSize: 22, lineHeight: 1.4, marginTop: 8, color: "var(--ink)" }}>
              {plant.story}
            </p>
          </div>

          {/* Quick facts */}
          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderTop: "1px solid var(--line-soft)", borderBottom: "1px solid var(--line-soft)" }}>
            {plant.quickFacts.map(([k, v], i) => (
              <div key={i} style={{ padding: "20px 24px 20px 0", borderRight: i < 3 ? "1px solid var(--line-soft)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
                <div className="tiny">{t(k)}</div>
                <div className="serif" style={{ fontSize: 22, marginTop: 6 }}>{t(v)}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ marginTop: 40, display: "flex", gap: 4, borderBottom: "1px solid var(--line-soft)" }}>
            {[
              ["story", t("The story") ],
              ["season", t("Seasonal view") ],
              ["data", t("Accession data") ],
              ["citations", t("Cited papers") ]
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "12px 18px",
                color: tab === id ? "var(--ink)" : "var(--ink-3)",
                fontWeight: tab === id ? 600 : 400,
                fontSize: 14,
                borderBottom: tab === id ? "2px solid var(--forest)" : "2px solid transparent",
                marginBottom: -1
              }}>{label}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ paddingTop: 28 }}>
            {tab === "story" && (
              <div className="col" style={{ gap: 18 }}>
                <p style={{ fontSize: 15, lineHeight: 1.7, color: "var(--ink-2)" }}>
                  {t("This specimen has been in continuous cultivation at Oulu since")} {plant.accession.split("-")[1]}. {t("Its accession")} ({plant.accession}) {t("traces back to")} {plant.accessed.toLowerCase()}. {t("Conservation work for this taxon is part of the Garden's ongoing partnership with the Finnish national seed bank and the Finnish Museum of Natural History (Luomus).")}
                </p>
                <p style={{ fontSize: 15, lineHeight: 1.7, color: "var(--ink-2)" }}>
                  {t("Head Gardener Tuomas Kauppila notes in the spring 2025 batch update: \"Strong rhizome growth this season; flowering predicted to be vigorous. Watch the south-facing slope for the first flush.\"")}
                </p>
                <button className="btn btn-secondary" style={{ alignSelf: "start", marginTop: 12 }}>
                  <Icon name="bot" size={14}/> {t("Ask the Garden about this plant")}
                </button>
              </div>
            )}
            {tab === "season" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  {seasons.map(s => (
                    <button key={s.id} onClick={() => setSeason(s.id)} className="pill" style={{
                      cursor: "pointer",
                      padding: "8px 14px",
                      background: season === s.id ? "var(--forest)" : "rgba(31,58,44,0.06)",
                      color: season === s.id ? "var(--paper)" : "var(--ink-2)"
                    }}><Icon name={s.icon} size={13}/> {s.label}</button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[1,2].map(i => (
                    <div key={i} style={{ aspectRatio: "4/3", borderRadius: 14, background: season === "winter" ? "linear-gradient(180deg, #e7ecf0 0%, #cbd4d8 100%)" : plant.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Botanical color={season === "winter" ? "#9DA8B4" : plant.color} accent={season === "winter" ? "#cbd4d8" : plant.accent} variant={plant.variant} style={{ width: "70%", height: "85%" }}/>
                    </div>
                  ))}
                </div>
                {season === "winter" && (
                  <div style={{ marginTop: 18, padding: 16, background: "#f0f3f5", borderRadius: 12, fontSize: 14, color: "var(--ink-2)" }}>
                    <Icon name="snow" size={14} style={{ verticalAlign: "middle", marginRight: 6, color: "var(--sky)" }}/>
                    {t("Under the snow now. What's happening below: rhizomes are dormant, mycorrhizal partners still active. Outdoor garden is closed for maintenance - visit Romeo & Julia year-round.")}
                  </div>
                )}
              </div>
            )}
            {tab === "data" && (
              <div className="card card-pad" style={{ background: "var(--paper)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {[
                      ["Accession number", plant.accession],
                      ["Source population", plant.accessed],
                      ["Source habitat", plant.habitat],
                      ["Coordinates (source)", "65.0617° N, 25.4661° E (anonymised)"],
                      ["Propagation method", "Seed (cold-stratified)"],
                      ["Conservation cohort", "LIFE+ ESCAPE (2012–2017)"],
                      ["Last batch update", "Spring 2025 - T. Kauppila"],
                      [ t("BGCI PlantSearch") , "Listed · 12 partner gardens hold this taxon"],
                      ["GBIF occurrences", "1 247 observations"]
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                        <td style={{ padding: "12px 0", color: "var(--ink-3)", fontSize: 13, width: "40%" }}>{k}</td>
                        <td style={{ padding: "12px 0", fontSize: 14, fontFamily: k === "Accession number" || k === "Coordinates (source)" ? "Geist Mono" : "Geist" }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tab === "citations" && (
              <div className="col" style={{ gap: 10 }}>
                {ASK_CITATIONS.slice(0, 4).map(c => (
                  <div key={c.id} className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "start" }}>
                    <div style={{ width: 36, height: 44, background: "var(--forest)", color: "var(--lichen)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontFamily: "Geist Mono", flexShrink: 0 }}>{c.year}</div>
                    <div style={{ flex: 1 }}>
                      <div className="tiny">{c.source}</div>
                      <div className="serif" style={{ fontSize: 17, marginTop: 4 }}>{c.title}</div>
                      <div className="small muted" style={{ marginTop: 4 }}>{c.page}</div>
                    </div>
                    <button className="icon-btn"><Icon name="arrow" size={14}/></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trail recommendation */}
          <div style={{ marginTop: 40, padding: "20px 24px", background: "var(--forest)", color: "var(--paper)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
            <div>
              <div className="tiny" style={{ color: "var(--lichen)" }}>{t("You're on the trail")}</div>
              <div className="serif" style={{ fontSize: 26, marginTop: 4 }}>{t("Endangered Finnish Natives")}</div>
              <div className="small" style={{ color: "rgba(248,244,230,0.7)", marginTop: 4 }}>{t("Stop 3 of 10 · 18 minutes to next")}</div>
            </div>
            <button className="btn" style={{ background: "var(--paper)", color: "var(--forest)" }}>
              {t("Next stop")} <Icon name="arrow" size={14}/>
            </button>
          </div>
        </div>

        {/* RIGHT - sticky CTA panel */}
        <div style={{ position: "sticky", top: 140, alignSelf: "start" }}>
          <div className="card" style={{ overflow: "hidden", borderRadius: 24 }}>
            {/* Mode toggle */}
            <div style={{ display: "flex", padding: 6, background: "var(--paper)", margin: 16, borderRadius: 999 }}>
              {[
                { id: "adult", label: t("Adult") },
                { id: "child", label: t("Kid mode") },
                { id: "school", label: t("School") }
              ].map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{
                  flex: 1, padding: "8px 0", borderRadius: 999, fontSize: 13,
                  background: mode === m.id ? "var(--forest)" : "transparent",
                  color: mode === m.id ? "var(--paper)" : "var(--ink-2)",
                  fontWeight: 500
                }}>{m.label}</button>
              ))}
            </div>

            <div style={{ padding: "0 24px 24px" }}>
              <div className="tiny">{t("Adoption status")}</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 8, gap: 12 }}>
                <div>
                  <div className="serif" style={{ fontSize: 36, lineHeight: 1 }}>{plant.adopters}</div>
                  <div className="tiny" style={{ marginTop: 4 }}>{t("Adopters")}</div>
                </div>
                <div className="small muted" style={{ textAlign: "right" }}>{plant.funded}% {t("funded")}</div>
              </div>
              <Progress pct={plant.funded} color={plant.color} height={6}/>

              <div style={{ marginTop: 24, padding: 16, background: "var(--paper)", borderRadius: 12 }}>
                <div className="tiny">{t("Suggested tier for this plant")}</div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <div className="serif" style={{ fontSize: 40 }}>€{plant.rarity === "CR" ? 500 : plant.rarity === "EN" || plant.rarity === "VU" ? 180 : 75}</div>
                  <div className="small muted">{t("or")} €{plant.rarity === "CR" ? 40 : plant.rarity === "EN" || plant.rarity === "VU" ? 15 : 7}{t("/month")}</div>
                </div>
                <div className="small" style={{ color: "var(--ink-2)", marginTop: 6 }}>{plant.rarity === "CR" ? t("Critically Endangered · engraved plaque tier") : plant.rarity === "EN" || plant.rarity === "VU" ? t("Vulnerable tier · Adopters' Day invite") : t("Common tier · named plant page")}</div>
              </div>

              <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} onClick={() => onAdopt(plant.id)}>
                <Icon name="seedling" size={16}/> {t("Adopt this plant")}
              </button>
              <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }}>
                <Icon name="gift" size={14}/> {t("Adopt as a gift")}
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost small" style={{ flex: 1, border: "1px solid var(--line)" }}>
                  <Icon name="heart" size={13}/> {t("Memorial")}
                </button>
                <button className="btn btn-ghost small" style={{ flex: 1, border: "1px solid var(--line)" }}>
                  <Icon name="school" size={13}/> {t("Class")} · €50
                </button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--line-soft)", padding: 20, background: "rgba(31,58,44,0.03)" }}>
              <div className="tiny">{t("Where your money goes")}</div>
              <div className="small" style={{ marginTop: 8, color: "var(--ink-2)" }}>{t("Of every €100: €62 direct ex-situ work, €18 to Luomus seed bank, €12 garden operations, €8 platform.")}</div>
              <button className="btn btn-ghost small" style={{ marginTop: 8, padding: "6px 0" }}>{t("Read the policy →")}</button>
            </div>
          </div>

          {/* Similar plants */}
          <div style={{ marginTop: 24 }}>
            <div className="tiny">{t("Similar plants")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {PLANTS.filter(p => p.id !== plant.id && p.family === plant.family).slice(0, 2).concat(PLANTS.filter(p => p.id !== plant.id).slice(0, 2)).slice(0, 3).map(p => (
                <button key={p.id} onClick={() => onNav("plant", p.id)} className="card" style={{ display: "flex", gap: 12, padding: 12, alignItems: "center", textAlign: "left" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 8, background: p.accent, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Botanical color={p.color} accent={p.accent} variant={p.variant} style={{ width: 38, height: 46 }}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="serif" style={{ fontSize: 16, fontStyle: "italic" }}>{p.name}</div>
                    <div className="small muted">{p.rarity} · {p.adopters} {t("adopters")}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.PlantScreen = PlantScreen;
