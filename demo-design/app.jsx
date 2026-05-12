// Main app - top nav + screen routing

// Read a hash like "#plant=puls-pat" or "#screen=adopt" into a route object.
const routeFromHash = () => {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash || "";
  const m = hash.match(/#(?:.*&)?plant=([^&]+)/);
  if (m) return { screen: "plant", plantId: decodeURIComponent(m[1]) };
  const s = hash.match(/#(?:.*&)?screen=([^&]+)/);
  if (s) return { screen: decodeURIComponent(s[1]) };
  return null;
};

const App = () => {
  const [route, setRoute] = React.useState(() => routeFromHash() || { screen: "discover" });
  const [lang, setLang] = React.useState("EN");
  const [openMenu, setOpenMenu] = React.useState(null); // "notif" | "account" | "a11y" | null
  const [a11y, setA11y] = React.useState(() => {
    if (typeof window === "undefined" || !window.localStorage) return { largerText: false, highContrast: false, reducedMotion: false };
    try { return JSON.parse(localStorage.getItem("bloom_a11y") || "{}"); } catch { return {}; }
  });
  const t = React.useCallback((s) => translate(s, lang), [lang]);

  // Apply accessibility settings to <body> classes
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("bloom-larger-text", !!a11y.largerText);
    document.body.classList.toggle("bloom-high-contrast", !!a11y.highContrast);
    document.body.classList.toggle("bloom-reduced-motion", !!a11y.reducedMotion);
    if (window.localStorage) localStorage.setItem("bloom_a11y", JSON.stringify(a11y));
  }, [a11y]);

  const nav = (screen, ...args) => {
    if (screen === "plant") setRoute({ screen, plantId: args[0] });
    else if (screen === "adopt") setRoute({ screen, plantId: args[0], intent: args[1] });
    else setRoute({ screen });
    setOpenMenu(null);
    // Update URL hash so the page is shareable and reload-safe (the
    // kiosk QR points at the same hash).
    if (typeof window !== "undefined") {
      let newHash = "";
      if (screen === "plant") newHash = `#plant=${encodeURIComponent(args[0])}`;
      else if (screen !== "discover") newHash = `#screen=${encodeURIComponent(screen)}`;
      if (newHash !== window.location.hash) {
        history.replaceState(null, "", newHash || window.location.pathname);
      }
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  // Listen to back/forward and external hash changes (e.g. user pastes a deep link)
  React.useEffect(() => {
    const handle = () => {
      const r = routeFromHash();
      if (r) setRoute(r);
    };
    window.addEventListener("hashchange", handle);
    window.addEventListener("popstate", handle);
    return () => {
      window.removeEventListener("hashchange", handle);
      window.removeEventListener("popstate", handle);
    };
  }, []);

  // Close dropdowns on click-outside or Escape
  React.useEffect(() => {
    if (!openMenu) return;
    const close = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return;
      if (e.type === "click" && e.target.closest("[data-menu-root]")) return;
      setOpenMenu(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [openMenu]);

  const notifications = [
    { icon: "flower", color: "var(--rust)", title: t("Pulsatilla patens is blooming"), time: t("3 hours ago"), unread: true },
    { icon: "gift", color: "var(--sage)", title: t("Your gift to Aino was opened"), time: t("Yesterday · 14:22"), unread: true },
    { icon: "leaf", color: "var(--teal)", title: t("Quarterly batch update posted"), time: t("May 1, 2026") },
    { icon: "bell", color: "var(--amber)", title: t("Renewal upcoming - Campanula uniflora"), time: t("8 June") }
  ];
  const unreadCount = notifications.filter(n => n.unread).length;

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
      {/* Skip to main content link (WCAG 2.4.1 Bypass Blocks) */}
      <a href="#main-content" className="skip-link">{t("Skip to main content")}</a>

      <header className="topbar" role="banner">
        <div className="topbar-inner">
          <div className="brand" onClick={() => nav("discover")}>
            <BloomMark size={36}/>
            <span>BloomOulu</span>
          </div>

          <nav className="nav" aria-label={t("Primary")}>
            {navItems.map(n => {
              const active = route.screen === n.id || (route.screen === "plant" && n.id === "discover");
              return (
                <button
                  key={n.id}
                  className={active ? "active" : ""}
                  onClick={() => nav(n.id)}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={n.icon} size={14}/> {n.label}
                </button>
              );
            })}
          </nav>

          <div className="topbar-right">
            <div className="lang-pill">
              {["FI", "SV", "EN"].map(l => (
                <button key={l} onClick={() => setLang(l)} className={lang === l ? "active" : ""}>{l}</button>
              ))}
            </div>
            {/* Notifications */}
            <div data-menu-root style={{ position: "relative" }}>
              <button
                className="icon-btn"
                title={t("Notifications")}
                onClick={() => setOpenMenu(m => m === "notif" ? null : "notif")}
                aria-expanded={openMenu === "notif"}
                style={{ position: "relative" }}
              >
                <Icon name="bell" size={15}/>
                {unreadCount > 0 && (
                  <span style={{
                    position: "absolute", top: -2, right: -2,
                    minWidth: 16, height: 16, padding: "0 4px",
                    borderRadius: 999, background: "var(--rust)", color: "var(--paper)",
                    fontSize: 9, fontWeight: 700, fontFamily: "var(--f-mono)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1.5px solid var(--paper)"
                  }}>{unreadCount}</span>
                )}
              </button>
              {openMenu === "notif" && (
                <div style={dropdownStyle}>
                  <div style={dropdownHeaderStyle}>
                    <span className="serif" style={{ fontSize: 16 }}>{t("Notifications")}</span>
                    <span className="tiny">{unreadCount} {t("unread")}</span>
                  </div>
                  <div style={{ maxHeight: 360, overflowY: "auto" }}>
                    {notifications.map((n, i) => (
                      <div key={i} style={{
                        display: "flex", gap: 12, padding: "12px 16px",
                        borderBottom: i < notifications.length - 1 ? "1px solid var(--line)" : "none",
                        background: n.unread ? "rgba(31,58,44,0.03)" : "transparent",
                        cursor: "pointer"
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(31,58,44,0.06)"}
                        onMouseLeave={e => e.currentTarget.style.background = n.unread ? "rgba(31,58,44,0.03)" : "transparent"}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--cream-deep)", color: n.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Icon name={n.icon} size={14}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{n.title}</div>
                          <div className="tiny" style={{ marginTop: 2 }}>{n.time}</div>
                        </div>
                        {n.unread && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--rust)", flexShrink: 0, marginTop: 6 }}/>}
                      </div>
                    ))}
                  </div>
                  <button
                    style={dropdownFooterStyle}
                    onClick={() => nav("garden")}
                  >
                    {t("See all in My Garden")} <Icon name="arrow" size={12}/>
                  </button>
                </div>
              )}
            </div>

            {/* Account */}
            <div data-menu-root style={{ position: "relative" }}>
              <button
                className="icon-btn"
                style={{ background: "var(--forest-deep)", color: "var(--sage-bright)", borderColor: "var(--forest-deep)" }}
                title="Mira Karjalainen"
                onClick={() => setOpenMenu(m => m === "account" ? null : "account")}
                aria-expanded={openMenu === "account"}
              >
                <Icon name="user" size={15}/>
              </button>
              {openMenu === "account" && (
                <div style={dropdownStyle}>
                  <div style={{ ...dropdownHeaderStyle, display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--forest-deep)", color: "var(--sage-bright)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name="user" size={18}/>
                    </div>
                    <div>
                      <div className="serif" style={{ fontSize: 16, lineHeight: 1.1 }}>Mira Karjalainen</div>
                      <div className="tiny" style={{ marginTop: 4 }}>{t("Silver")} · €430 {t("lifetime")}</div>
                    </div>
                  </div>
                  {[
                    { label: t("My Garden"), icon: "user", action: () => nav("garden") },
                    { label: t("Adopt another"), icon: "seedling", action: () => nav("adopt") },
                    { label: t("Notification preferences"), icon: "bell", action: () => nav("garden") },
                    { label: t("Tax & receipts"), icon: "info", action: () => nav("garden") },
                    { label: t("Account settings"), icon: "building", action: () => {} },
                    { label: t("Sign out"), icon: "back", action: () => {} }
                  ].map((item, i, arr) => (
                    <button key={item.label} onClick={item.action} style={{
                      display: "flex", alignItems: "center", gap: 12, width: "100%",
                      padding: "12px 16px", textAlign: "left",
                      background: "transparent", border: 0, cursor: "pointer",
                      color: i === arr.length - 1 ? "var(--rust)" : "var(--ink-soft)",
                      borderTop: i === 0 ? "none" : (i === arr.length - 1 ? "1px solid var(--line)" : "none"),
                      fontSize: 13
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(31,58,44,0.05)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <Icon name={item.icon} size={14}/>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {route.screen === "discover" && <DiscoverScreen onOpenPlant={id => nav("plant", id)} onNav={nav}/>}
        {route.screen === "plant" && <PlantScreen plantId={route.plantId} onBack={() => nav("discover")} onNav={nav} onAdopt={(id, intent) => nav("adopt", id, intent)}/>}
        {route.screen === "adopt" && <AdoptScreen presetPlantId={route.plantId} presetIntent={route.intent} onNav={nav}/>}
        {route.screen === "ask" && <AskScreen onNav={nav} onOpenPlant={id => nav("plant", id)}/>}
        {route.screen === "garden" && <GardenScreen onOpenPlant={id => nav("plant", id)} onNav={nav}/>}
        {route.screen === "kiosk" && <KioskScreen onNav={nav}/>}
      </main>

      {/* Live toast announcer */}
      <Toaster/>

      {/* Accessibility settings floating button + panel */}
      <button
        className="a11y-fab"
        onClick={() => setOpenMenu(m => m === "a11y" ? null : "a11y")}
        aria-expanded={openMenu === "a11y"}
        aria-controls="a11y-panel"
        aria-label={t("Accessibility settings")}
        title={t("Accessibility settings")}
      >
        {/* Universal accessibility person icon */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="4.5" r="2"/>
          <path d="M12 6.5v6"/>
          <path d="M4 8h16"/>
          <path d="M8.5 22 12 15l3.5 7"/>
        </svg>
      </button>
      {openMenu === "a11y" && (
        <div id="a11y-panel" className="a11y-panel" role="dialog" aria-modal="false" aria-label={t("Accessibility settings")} data-menu-root>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2>{t("Accessibility")}</h2>
            <button
              onClick={() => setOpenMenu(null)}
              className="icon-btn"
              aria-label={t("Close")}
              style={{ width: 30, height: 30 }}
            >
              <Icon name="close" size={14}/>
            </button>
          </div>
          <div className="a11y-row">
            <label htmlFor="a11y-larger">{t("Larger text")}</label>
            <input id="a11y-larger" type="checkbox" checked={!!a11y.largerText} onChange={e => setA11y(s => ({ ...s, largerText: e.target.checked }))}/>
          </div>
          <div className="a11y-row">
            <label htmlFor="a11y-contrast">{t("High contrast")}</label>
            <input id="a11y-contrast" type="checkbox" checked={!!a11y.highContrast} onChange={e => setA11y(s => ({ ...s, highContrast: e.target.checked }))}/>
          </div>
          <div className="a11y-row">
            <label htmlFor="a11y-motion">{t("Reduce motion")}</label>
            <input id="a11y-motion" type="checkbox" checked={!!a11y.reducedMotion} onChange={e => setA11y(s => ({ ...s, reducedMotion: e.target.checked }))}/>
          </div>
          <p className="tiny" style={{ marginTop: 14, textTransform: "none", letterSpacing: 0, lineHeight: 1.5, color: "var(--ink-mute)" }}>
            {t("BloomOulu targets WCAG 2.2 AA and the European Accessibility Act 2025. Preferences are saved on this device only.")}
          </p>
        </div>
      )}

      {/* Mobile bottom tab bar - shown via CSS at <=768px */}
      <nav className="mobile-tabs" aria-label={t("Primary")}>
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
        <footer role="contentinfo" style={{ background: "var(--forest-deep)", color: "var(--cream)", marginTop: 64, padding: "56px 0 40px", position: "relative", overflow: "hidden" }}>
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
                <button
                  className="icon-btn"
                  aria-label={t("Share BloomOulu")}
                  onClick={async () => {
                    const r = await sharePlant({ name: "BloomOulu", story: "Adopt a plant. Keep Finland in bloom.", id: "" });
                    if (r.mode === "shared") showToast(t("Shared"));
                    else if (r.mode === "copied") showToast(t("Link copied to clipboard"));
                  }}
                  style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.2)" }}
                ><Icon name="share" size={14}/></button>
                <button className="icon-btn" aria-label={t("Language")} style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.2)" }}><Icon name="globe" size={14}/></button>
                <button className="icon-btn" aria-label={t("About")} style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.2)" }}><Icon name="info" size={14}/></button>
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

// Toaster: listens for "bloom_toast" CustomEvents and renders them.
const Toaster = () => {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => {
    const handler = (e) => {
      const id = Math.random().toString(36).slice(2);
      const message = e.detail?.message || "";
      setToasts(t => [...t, { id, message }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
    };
    window.addEventListener("bloom_toast", handler);
    return () => window.removeEventListener("bloom_toast", handler);
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="bloom-toaster" role="status" aria-live="polite" aria-atomic="true">
      {toasts.map(t => <div key={t.id} className="bloom-toast">{t.message}</div>)}
    </div>
  );
};
window.Toaster = Toaster;

// Shared dropdown styling
const dropdownStyle = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  width: 320,
  maxWidth: "calc(100vw - 32px)",
  background: "var(--paper)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  boxShadow: "var(--shadow-deep)",
  zIndex: 200,
  overflow: "hidden"
};
const dropdownHeaderStyle = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--line)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center"
};
const dropdownFooterStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  padding: "12px",
  borderTop: "1px solid var(--line)",
  background: "rgba(31,58,44,0.03)",
  fontSize: 13,
  color: "var(--forest-deep)",
  fontWeight: 500,
  cursor: "pointer",
  border: 0
};

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
