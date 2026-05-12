// Lobby Kiosk view — full-bleed touchscreen display in the garden lobby

const KioskScreen = ({ onNav }) => {
  const { t, lang } = useT();
  const [time, setTime] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Stable QR module pattern — generated once, not on every clock tick
  const qrModules = React.useMemo(() => {
    return Array.from({ length: 120 }, (_, i) => {
      const x = 12 + (i * 7) % 156;
      const y = 70 + Math.floor((i * 11) / 24) * 6;
      if ((x < 60 && y < 60) || (x > 120 && y < 60) || (x < 60 && y > 120)) return null;
      // Deterministic pseudo-random based on index
      const filled = ((i * 2654435761) >>> 0) % 100 > 45;
      return { x, y, filled };
    }).filter(Boolean);
  }, []);

  return (
    <div className="fade-in" style={{ background: "var(--forest-deep)", minHeight: "calc(100vh - 65px)", color: "var(--cream)", padding: "32px 48px", position: "relative", overflow: "hidden" }}>
      {/* Veining */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(115deg, transparent, transparent 80px, rgba(168,192,96,.03) 80px, rgba(168,192,96,.03) 81px)", pointerEvents: "none" }}/>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 80% 20%, rgba(95,176,160,0.15) 0%, transparent 50%), radial-gradient(circle at 10% 80%, rgba(168,192,96,0.10) 0%, transparent 50%)", pointerEvents: "none" }}/>

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Kiosk header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 28, borderBottom: "1px solid rgba(250,247,238,0.14)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <BloomMark size={48} monochrome light/>
            <div>
              <div className="serif" style={{ fontSize: 32, color: "var(--cream)", letterSpacing: "-0.02em" }}>{t("Tervetuloa.")}</div>
              <div className="eyebrow eyebrow--sage" style={{ marginTop: 4 }}>{t("Lobby kiosk · Romeo & Julia entrance")}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div className="serif" style={{ fontSize: 32, color: "var(--cream)" }}>{time.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" })}</div>
              <div className="eyebrow eyebrow--sage">{t("Tuesday · 12 May 2026")}</div>
            </div>
            <div className="pill pill-on-dark" style={{ padding: "10px 18px", fontSize: 14 }}>
              <Icon name="sun" size={16}/> 12 °C · partly sunny
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 24 }}>
          {/* Blooming now — feature card */}
          <div style={{ background: "linear-gradient(160deg, rgba(250,247,238,0.06) 0%, rgba(250,247,238,0.02) 100%)", borderRadius: 16, border: "1px solid rgba(250,247,238,0.12)", padding: 32, position: "relative", overflow: "hidden" }}>
            <div className="eyebrow eyebrow--sage">{t("Blooming today")}</div>
            <h2 style={{ fontSize: 56, marginTop: 16, color: "var(--cream)", fontStyle: "italic" }}>Pulsatilla patens</h2>
            <div className="serif" style={{ fontSize: 22, color: "var(--sage-bright)", marginTop: 4 }}>{t("Hämeenkylmänkukka · pasqueflower")}</div>
            <p style={{ fontSize: 17, color: "rgba(250,247,238,0.78)", lineHeight: 1.5, marginTop: 20, maxWidth: 480 }}>
              Critically endangered in Finland. First buds opening today on the south esker bed.
              Walk 220m through the main gate, turn left at the meadow.
            </p>
            <div style={{ marginTop: 28, display: "flex", gap: 12 }}>
              <button className="btn btn-grad btn-lg" onClick={() => onNav("plant", "puls-pat")}>
                <Icon name="qr" size={16}/> {t("Scan to begin tour")}
              </button>
              <button className="btn pill-on-dark" style={{ color: "var(--cream)" }}>
                <Icon name="map" size={14}/> {t("Show on map")}
              </button>
            </div>

            {/* Botanical illustration */}
            <div style={{ position: "absolute", right: -40, bottom: -40, width: 320, height: 380, opacity: 0.5 }}>
              <Botanical color="#A8C060" accent="rgba(168,192,96,0.2)" variant={0} style={{ width: "100%", height: "100%" }}/>
            </div>
          </div>

          {/* QR launcher */}
          <div style={{ background: "var(--cream)", color: "var(--ink)", borderRadius: 16, padding: 32, display: "flex", flexDirection: "column" }}>
            <div className="eyebrow">{t("Begin your visit")}</div>
            <h3 className="serif" style={{ fontSize: 32, marginTop: 12 }}>{t("Scan any plant.")}</h3>
            <p className="small muted" style={{ marginTop: 8 }}>{t("3-language audio narration.")}</p>

            <div style={{ marginTop: 28, alignSelf: "center", padding: 24, background: "var(--paper)", borderRadius: 12, boxShadow: "var(--shadow-soft)" }}>
              {/* Stylised QR */}
              <svg width="180" height="180" viewBox="0 0 180 180">
                <rect width="180" height="180" fill="white"/>
                {/* 3 finders */}
                {[[12, 12], [120, 12], [12, 120]].map(([x, y], i) => (
                  <g key={i}>
                    <rect x={x} y={y} width="48" height="48" fill="var(--forest-deep)"/>
                    <rect x={x+8} y={y+8} width="32" height="32" fill="var(--cream)"/>
                    <rect x={x+16} y={y+16} width="16" height="16" fill="var(--forest-deep)"/>
                  </g>
                ))}
                {/* random modules — stable across re-renders */}
                {qrModules.map((m, i) => (
                  <rect key={i} x={m.x} y={m.y} width="6" height="6" fill={m.filled ? "var(--forest-deep)" : "transparent"}/>
                ))}
                <g transform="translate(72, 72)">
                  <rect width="36" height="36" fill="var(--cream)"/>
                  <g transform="translate(2, 2)"><BloomMark size={32}/></g>
                </g>
              </svg>
            </div>
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink-soft)" }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--forest)", color: "var(--cream)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600 }}>1</span>
                {t("Open your camera, point at any plant label")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink-soft)", marginTop: 8 }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--forest)", color: "var(--cream)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600 }}>2</span>
                {t("Listen, read, or ask. Adopt if you fall in love.")}
              </div>
            </div>
          </div>

          {/* AskTheGarden card */}
          <div style={{ background: "linear-gradient(160deg, #A8C060 0%, #5FB0A0 100%)", color: "var(--forest-deep)", borderRadius: 16, padding: 32, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div className="eyebrow" style={{ color: "var(--forest-deep)" }}>{t("Ask the Garden")}</div>
              <h3 className="serif" style={{ fontSize: 32, marginTop: 12, color: "var(--forest-deep)" }}>What would you like to&nbsp;know?</h3>
              <p className="small" style={{ marginTop: 12, color: "rgba(31,60,45,0.8)", lineHeight: 1.5 }}>
                {t("Speak or type. Trained on the Garden's own science. Every answer cites its source.")}
              </p>
            </div>

            <div style={{ marginTop: 24 }}>
              {[ t("What's blooming this week?") , t("Where are the endangered plants?") , t("When does the water lily bloom?") ].map(q => (
                <button key={q} onClick={() => onNav("ask")} style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "12px 16px", borderRadius: 10, marginBottom: 8,
                  background: "rgba(31,60,45,0.1)", color: "var(--forest-deep)",
                  fontSize: 13, fontWeight: 500
                }}>"{q}"</button>
              ))}
              <button className="btn" style={{ background: "var(--forest-deep)", color: "var(--cream)", width: "100%", marginTop: 8 }} onClick={() => onNav("ask")}>
                <Icon name="mic" size={14}/> {t("Tap to speak")}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "2fr 1.2fr", gap: 24 }}>
          {/* Adopter wall — scrolling */}
          <div style={{ background: "rgba(250,247,238,0.04)", borderRadius: 16, border: "1px solid rgba(250,247,238,0.12)", padding: 28, overflow: "hidden", position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <div className="eyebrow eyebrow--sage">{t("The adopter wall")}</div>
                <h3 className="serif" style={{ fontSize: 28, marginTop: 8, color: "var(--cream)" }}>{t("1 247 supporters · €68 420 raised")}</h3>
              </div>
              <div className="pill pill-on-dark" style={{ color: "var(--cream)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sage-bright)", animation: "blink 1.6s infinite", display: "inline-block" }}/>
                {t("Live · since launch")}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", maxHeight: 220, overflow: "hidden" }}>
              {[
                "Mira K.", "Aino N.", "Eero L.", "Class 5A · Oulun normaalikoulu", "Nordic Semiconductor",
                "Päivi & Heikki", "Tuomas Kauppila", "In memory of Eeva", "Tampereen Yliopisto",
                "Aalto Botany Society", "Anonymous Friend", "Tytti M.", "Helsingin LK", "Bittium Oyj",
                "From a Finn in Berlin", "Sini & Riku", "Nokia Bell Labs", "Polar Electro",
                "Sara R.", "Pekka V.", "Joonas T.", "Maiju P.", "Antti H.", "Lumo & Niilo",
                "Tiia K.", "Sami O.", "BoogiE Sw.", "Linnea J.", "Suomen Akatemia · 2025",
                "Reetta", "Karri & Tuula", "Veera S.", "Otto V.", "Wäinö Aaltonen Lukio"
              ].map((name, i) => {
                const isCorp = name.includes("Oyj") || name.includes("Yliopisto") || name.includes("Nokia") || name.includes("Nordic") || name.includes("Polar") || name.includes("Bittium") || name.includes("Akatemia") || name.includes("BoogiE") || name.includes("Lukio") || name.includes("Aalto") || name.includes("Helsingin") || name.includes("Class") || name.includes("Tampereen");
                const isMemorial = name.includes("memory");
                return (
                  <span key={i} style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: isCorp ? "rgba(168,192,96,0.18)" : isMemorial ? "rgba(178,92,58,0.18)" : "rgba(250,247,238,0.08)",
                    color: isCorp ? "var(--sage-bright)" : isMemorial ? "#E5A88B" : "var(--cream)",
                    fontSize: 13,
                    fontFamily: isMemorial ? "var(--f-display)" : "var(--f-body)",
                    fontStyle: isMemorial ? "italic" : "normal",
                    border: "1px solid rgba(250,247,238,0.08)"
                  }}>{name}</span>
                );
              })}
            </div>
            {/* fade overlay */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(180deg, transparent, var(--forest-deep))", pointerEvents: "none" }}/>
          </div>

          {/* Today's stats / live counter */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: t("Scans today"), value: "184", sub: t("+23% vs avg"), icon: "qr" },
              { label: t("Questions asked"), value: "47", sub: t("12 to curator"), icon: "bot" },
              { label: t("Adoptions today"), value: "9", sub: t("€612 raised"), icon: "seedling" },
              { label: t("Audio plays"), value: "312", sub: t("Avg 47 sec"), icon: "play" }
            ].map(s => (
              <div key={s.label} style={{ padding: 20, background: "rgba(250,247,238,0.04)", borderRadius: 12, border: "1px solid rgba(250,247,238,0.10)" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(168,192,96,0.2)", color: "var(--sage-bright)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={s.icon} size={14}/>
                </div>
                <div className="serif" style={{ fontSize: 36, color: "var(--cream)", marginTop: 12, lineHeight: 1 }}>{s.value}</div>
                <div className="eyebrow eyebrow--sage" style={{ marginTop: 6 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: "rgba(250,247,238,0.6)", marginTop: 4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid rgba(250,247,238,0.14)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(250,247,238,0.5)", fontFamily: "var(--f-mono)", letterSpacing: "0.16em", textTransform: "uppercase" }}>
          <span>{t("University of Oulu Botanical Garden · 65.0617° N")}</span>
          <span>BloomOulu v1.0 · {time.toLocaleDateString("fi-FI")}</span>
        </div>
      </div>
    </div>
  );
};

window.KioskScreen = KioskScreen;
