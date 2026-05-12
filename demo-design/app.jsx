// Main app - top nav + screen routing

const App = () => {
  const [route, setRoute] = React.useState({ screen: "discover" });
  const [lang, setLang] = React.useState("EN");
  const t = React.useCallback((s) => translate(s, lang), [lang]);

  const nav = (screen, ...args) => {
    if (screen === "plant") setRoute({ screen, plantId: args[0] });
    else if (screen === "adopt") setRoute({ screen, plantId: args[0] });
    else setRoute({ screen });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const navItems = [
    { id: "discover", label: t("Discover"), icon: "leaf" },
    { id: "ask", label: t("AskTheGarden"), icon: "bot" },
    { id: "adopt", label: t("Adopt"), icon: "seedling" },
    { id: "garden", label: t("My Garden"), icon: "user" },
    { id: "kiosk", label: t("Kiosk"), icon: "building" }
  ];

  const isFullBleed = route.screen === "ask" || route.screen === "kiosk";

  return (
    <LangContext.Provider value={{ lang, t, setLang }}>
    <div style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand" onClick={() => nav("discover")}>
            <BloomMark size={36}/>
            <span>BloomOulu</span>
          </div>

          <nav className="nav">
            {navItems.map(n => (
              <button key={n.id} className={route.screen === n.id || (route.screen === "plant" && n.id === "discover") ? "active" : ""}
                onClick={() => nav(n.id)}>
                <Icon name={n.icon} size={14}/> {n.label}
              </button>
            ))}
          </nav>

          <div className="topbar-right">
            <div className="lang-pill">
              {["FI", "SV", "EN"].map(l => (
                <button key={l} onClick={() => setLang(l)} className={lang === l ? "active" : ""}>{l}</button>
              ))}
            </div>
            <button className="icon-btn" title="Notifications"><Icon name="bell" size={15}/></button>
            <button className="icon-btn" style={{ background: "var(--forest-deep)", color: "var(--sage-bright)", borderColor: "var(--forest-deep)" }} title="Mira"><Icon name="user" size={15}/></button>
          </div>
        </div>
      </header>

      <main>
        {route.screen === "discover" && <DiscoverScreen onOpenPlant={id => nav("plant", id)} onNav={nav}/>}
        {route.screen === "plant" && <PlantScreen plantId={route.plantId} onBack={() => nav("discover")} onNav={nav} onAdopt={id => nav("adopt", id)}/>}
        {route.screen === "adopt" && <AdoptScreen presetPlantId={route.plantId} onNav={nav}/>}
        {route.screen === "ask" && <AskScreen onNav={nav} onOpenPlant={id => nav("plant", id)}/>}
        {route.screen === "garden" && <GardenScreen onOpenPlant={id => nav("plant", id)} onNav={nav}/>}
        {route.screen === "kiosk" && <KioskScreen onNav={nav}/>}
      </main>

      {/* Mobile bottom tab bar - shown via CSS at <=768px */}
      <nav className="mobile-tabs" aria-label="Primary">
        {navItems.map(n => (
          <button
            key={n.id}
            className={route.screen === n.id || (route.screen === "plant" && n.id === "discover") ? "active" : ""}
            onClick={() => nav(n.id)}
            aria-current={route.screen === n.id ? "page" : undefined}
          >
            <Icon name={n.icon} size={20}/>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer - hide on full-bleed screens */}
      {!isFullBleed && (
        <footer style={{ background: "var(--forest-deep)", color: "var(--cream)", marginTop: 64, padding: "56px 0 40px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(115deg, transparent, transparent 80px, rgba(168,192,96,.04) 80px, rgba(168,192,96,.04) 81px)", pointerEvents: "none" }}/>
          <div className="container" style={{ position: "relative", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", gap: 48, paddingTop: 0, paddingBottom: 0 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <BloomMark size={40} monochrome light/>
                <span className="serif" style={{ fontSize: 24, color: "var(--cream)" }}>BloomOulu</span>
              </div>
              <p style={{ marginTop: 20, fontSize: 14, color: "rgba(250,247,238,0.65)", lineHeight: 1.55, maxWidth: 320 }}>
                {t("One platform for the University of Oulu Botanical Garden - adoption, AI-grounded answers, and the QR plant experience. Built with Team Meraki for GrowthHack 2026.")}
              </p>
              <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
                <button className="icon-btn" style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.2)" }}><Icon name="share" size={14}/></button>
                <button className="icon-btn" style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.2)" }}><Icon name="globe" size={14}/></button>
                <button className="icon-btn" style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.2)" }}><Icon name="info" size={14}/></button>
              </div>
            </div>

            {[
              { title: "Garden", links: ["Plan a visit", "Romeo & Julia greenhouses", "What's blooming", "Garden map", "Accessibility (EAA 2025)"] },
              { title: "Support", links: ["Adopt a plant", "Memorial gifts", "Corporate sponsorship", "Legacy giving", "Tax & receipts"] },
              { title: "Research", links: ["Biodiversity Unit", "LIFE+ ESCAPE", "Accession database", "BGCI PlantSearch", "Publications"] },
              { title: "Platform", links: ["AskTheGarden", "Staff portal", "Kiosk view", "Privacy / GDPR", "Funds-flow policy"] }
            ].map(c => (
              <div key={c.title}>
                <div className="eyebrow eyebrow--sage">{t(c.title)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                  {c.links.map(l => (
                    <a key={l} href="#" style={{ fontSize: 13, color: "rgba(250,247,238,0.78)", textDecoration: "none" }}>{t(l)}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="container" style={{ position: "relative", borderTop: "1px solid rgba(250,247,238,0.14)", marginTop: 48, paddingTop: 24, paddingBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, fontFamily: "var(--f-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(250,247,238,0.4)" }}>
              © 2026 University of Oulu · Biodiversity Unit · 65.0617° N, 25.4661° E
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: "var(--f-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(250,247,238,0.4)" }}>
              <span>WCAG 2.2 AA</span>
              <span>·</span>
              <span>GDPR-compliant</span>
              <span>·</span>
              <span>Hosted in EU</span>
            </div>
          </div>
        </footer>
      )}
    </div>
    </LangContext.Provider>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
