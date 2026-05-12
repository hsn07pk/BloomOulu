// My Garden - adopter dashboard (post-adoption)

const GardenScreen = ({ onOpenPlant, onNav }) => {
  const { t, lang } = useT();
  const myPlants = [PLANTS[0], PLANTS[1], PLANTS[5]].map(p => localisePlant(p, lang)); // Pulsatilla, Campanula, Cypripedium
  const [celebrate, setCelebrate] = React.useState(true);
  const { saved: savedIds, toggle: toggleSaved } = useSavedPlants();
  const savedPlants = savedIds
    .map(id => PLANTS.find(p => p.id === id))
    .filter(Boolean)
    .filter(p => !myPlants.some(my => my.id === p.id))
    .map(p => localisePlant(p, lang));

  return (
    <div className="fade-in">
      {/* Confetti / success banner */}
      {celebrate && (
        <div style={{ background: "var(--forest-deep)", color: "var(--cream)", position: "relative", overflow: "hidden" }}>
          <div className="container" style={{ padding: "20px 32px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--sage-bright)", color: "var(--forest-deep)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={20}/>
            </div>
            <div style={{ flex: 1 }}>
              <div className="serif" style={{ fontSize: 22, color: "var(--cream)" }}>{t("Welcome to your garden, Mira.")}</div>
              <div className="small" style={{ color: "rgba(250,247,238,0.7)" }}>Your adoption of <i>Pulsatilla patens</i> is confirmed. Receipt sent to mira@example.fi. First-bloom alert scheduled.</div>
            </div>
            <button className="btn btn-secondary" style={{ background: "transparent", color: "var(--cream)", borderColor: "rgba(250,247,238,0.3)" }} onClick={() => setCelebrate(false)}>
              <Icon name="close" size={14}/> {t("Dismiss")}
            </button>
          </div>
        </div>
      )}

      <div className="container" style={{ paddingTop: 48, paddingBottom: 64 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 48 }}>
          <div>
            <div className="eyebrow">{t("My Garden · Mira Karjalainen")}</div>
            <h1 style={{ fontSize: 72, marginTop: 16 }}>Tervetuloa takaisin,<br/><span className="italic-serif accent-grad">Mira</span>.</h1>
            <p className="muted" style={{ marginTop: 16, fontSize: 16, maxWidth: 560 }}>
              {t("Three plants, two memorial gifts, one class adoption. Cumulative giving since June 2024: €430.")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-secondary"><Icon name="bell" size={14}/> {t("Notification preferences")}</button>
            <button className="btn btn-primary" onClick={() => onNav("adopt")}><Icon name="plus" size={14}/> {t("Adopt another")}</button>
          </div>
        </div>

        {/* Loyalty + impact strip */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 16, marginBottom: 48 }}>
          {/* Loyalty card */}
          <div className="card" style={{ padding: 0, overflow: "hidden", background: "var(--forest-deep)", color: "var(--cream)", position: "relative" }}>
            <div style={{ padding: 28, position: "relative", zIndex: 1 }}>
              <div className="eyebrow eyebrow--sage">{t("Adopter status")}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 14 }}>
                <div className="serif" style={{ fontSize: 56, color: "var(--cream)", lineHeight: 1 }}>{t("Silver")}</div>
                <span className="pill pill-on-dark">€430 {t("lifetime")}</span>
              </div>
              <div className="small" style={{ color: "rgba(250,247,238,0.7)", marginTop: 8 }}>
                €570 {t("to")} <b style={{ color: "var(--sage-bright)" }}>{t("Gold")}</b>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 6, background: "rgba(250,247,238,0.14)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: "43%", height: "100%", background: "linear-gradient(90deg, var(--sage) 0%, var(--sage-bright) 100%)" }}/>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }} className="tiny">
                  <span style={{ color: "rgba(250,247,238,0.5)" }}>Bronze · €0</span>
                  <span style={{ color: "var(--sage-bright)" }}>Silver · €200</span>
                  <span style={{ color: "rgba(250,247,238,0.5)" }}>Gold · €1000</span>
                </div>
              </div>
            </div>
            {/* Decorative bloom */}
            <div style={{ position: "absolute", right: -30, top: -20, opacity: 0.15 }}>
              <BloomMark size={200} monochrome light/>
            </div>
          </div>

          {/* Impact card */}
          <div className="card card-pad">
            <div className="eyebrow">{t("Your conservation impact")}</div>
            <div className="serif" style={{ fontSize: 44, marginTop: 12 }}>€266</div>
            <div className="small muted">{t("to direct ex-situ work · 62%")}</div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                [ t("Seed bank deposits") , 77, "var(--sage)"],
                [ t("Garden operations") , 52, "var(--teal)"],
                [ t("Platform costs") , 34, "var(--ink-mute)"]
              ].map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span className="muted">{l}</span>
                  <span style={{ fontFamily: "var(--f-mono)", color: c, fontWeight: 600 }}>€{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Next milestone */}
          <div className="card card-pad" style={{ background: "var(--sage-pale)" }}>
            <div className="eyebrow eyebrow--rust">{t("Coming up")}</div>
            <div className="serif" style={{ fontSize: 28, marginTop: 12, lineHeight: 1.15 }}>{t("Adopters' Day")}</div>
            <div className="small" style={{ marginTop: 4, color: "var(--ink-soft)" }}>{t("Saturday 21 June 2026 · 13:00")}</div>
            <p className="small" style={{ marginTop: 12, color: "var(--ink-soft)", lineHeight: 1.5 }}>
              {t("Guided tour by Curator Anna Liisa Ruotsalainen + peak peony bloom + Romeo & Julia behind-the-scenes.")}
            </p>
            <button className="btn btn-primary small" style={{ marginTop: 14 }}>{t("RSVP · 2 guests included")}</button>
          </div>
        </div>

        {/* My plants */}
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div className="eyebrow">{t("Your plants")}</div>
            <h2 style={{ fontSize: 40, marginTop: 12 }}>{t("Three living dedications.")}</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pill"><Icon name="calendar" size={13}/> {t("Bloom calendar")}</button>
            <button className="pill"><Icon name="map" size={13}/> {t("Garden map")}</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {myPlants.map((p, i) => (
            <div key={p.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ height: 220, background: p.accent, position: "relative", overflow: "hidden" }}>
                <PlantImage plant={p} style={{ width: "100%", height: "100%" }}/>
                {i === 0 && (
                  <div style={{ position: "absolute", top: 14, right: 14, padding: "6px 12px", background: "var(--rust)", color: "var(--cream)", borderRadius: 999, fontSize: 11, fontFamily: "var(--f-mono)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cream)", display: "inline-block", animation: "blink 1.6s infinite" }}/>
                    {t("BLOOMING NOW")}
                  </div>
                )}
                <div style={{ position: "absolute", bottom: 14, left: 14, right: 14, padding: "8px 12px", background: "rgba(250,247,238,0.92)", borderRadius: 8, fontSize: 12, fontFamily: "var(--f-mono)" }}>
                  {p.accession}
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div className="eyebrow">{[ t("Vulnerable tier · €250/yr") , t("Rooted tier · €75/yr") , t("Endangered tier · €750/yr") ][i]}</div>
                <div className="serif" style={{ fontSize: 26, fontStyle: "italic", marginTop: 8, lineHeight: 1.1 }}>{p.name}</div>
                <div className="small muted" style={{ marginTop: 4 }}>{p.fi} · adopted {[ t("12 May 2026") , t("8 Jun 2024") , t("3 Mar 2025") ][i]}</div>

                {/* Latest update */}
                <div style={{ marginTop: 16, padding: 14, background: "var(--cream-deep)", borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div className="tiny" style={{ marginBottom: 6 }}>{[ t("3 days ago · Head Gardener") , t("Last week · Curator") , t("2 weeks ago · Gardener") ][i]}</div>
                  <span style={{ color: "var(--ink-soft)" }}>{[
                    t("First buds opening on the south slope. Watch this week - peak bloom predicted Sat–Sun. We'll send the bloom alert email."),
                    t("Strong rosette growth this season. New fell-soil mix proving favourable; expect more flowers than 2024."),
                    t("Rhizome divided into two pots - both healthy. Flowering not expected until 2027 (orchids are patient).")
                  ][i]}</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                  <button className="btn btn-secondary small" onClick={() => onOpenPlant(p.id)}>{t("View page")}</button>
                  <button className="btn btn-ghost small" onClick={async () => {
                    const r = await sharePlant(p);
                    if (r.mode === "shared") showToast(t("Shared"));
                    else if (r.mode === "copied") showToast(t("Link copied to clipboard"));
                  }}><Icon name="share" size={13}/> {t("Share")}</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Saved for later - bookmarked plants */}
        {savedPlants.length > 0 && (
          <div style={{ marginTop: 48 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 className="serif" style={{ fontSize: 24 }}>📑 {t("Saved for later")}</h3>
              <span className="tiny">{savedPlants.length} {savedPlants.length === 1 ? t("plant") : t("plants")}</span>
            </div>
            <div data-grid-mobile="2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {savedPlants.map(p => (
                <div key={p.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <button onClick={() => onOpenPlant(p.id)} style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ height: 140, background: p.accent, overflow: "hidden" }}>
                      <PlantImage plant={p} style={{ width: "100%", height: "100%" }}/>
                    </div>
                    <div style={{ padding: 14 }}>
                      <div className="serif" style={{ fontSize: 16, fontStyle: "italic", lineHeight: 1.1 }}>{p.name}</div>
                      <div className="tiny" style={{ marginTop: 4 }}>{p.fi || p.localName} · {p.rarity}</div>
                    </div>
                  </button>
                  <div style={{ display: "flex", borderTop: "1px solid var(--line)", fontSize: 12 }}>
                    <button onClick={() => onOpenPlant(p.id)} style={{ flex: 1, padding: "10px 8px", background: "transparent", border: 0, borderRight: "1px solid var(--line)", color: "var(--ink-soft)", cursor: "pointer" }}>{t("View")}</button>
                    <button onClick={() => { toggleSaved(p.id); showToast(t("Removed from My Garden")); }} style={{ flex: 1, padding: "10px 8px", background: "transparent", border: 0, color: "var(--rust)", cursor: "pointer" }}>{t("Remove")}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity feed + memorials side by side */}
        <div style={{ marginTop: 56, display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
          <div>
            <h3 className="serif" style={{ fontSize: 28 }}>{t("Activity")}</h3>
            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              {[
                { icon: "flower", color: "var(--rust)", title: "Pulsatilla patens is blooming", time: t("3 hours ago"), body: t("First buds opened - peak this weekend. Tap to plan a visit.") },
                { icon: "gift", color: "var(--sage)", title: t("Your gift to Aino was opened"), time: t("Yesterday · 14:22"), body: t("She viewed the Trollius europaeus certificate. She hasn't sent a thank-you yet.") },
                { icon: "leaf", color: "var(--teal)", title: t("Quarterly batch update posted"), time: t("May 1, 2026"), body: t("Gardener Kauppila's notes on all your plants. Read what changed this quarter.") },
                { icon: "bell", color: "var(--amber)", title: t("Renewal upcoming - Campanula uniflora"), time: t("8 June"), body: t("Anniversary of your 2024 adoption. Renew at the same tier or upgrade.") },
                { icon: "school", color: "var(--forest)", title: t("Class 5A adopted Trollius europaeus"), time: t("April 22"), body: t("Oulun normaalikoulu, Mrs. Mäkelä's class - your class-sponsorship was matched.") }
              ].map((a, i) => (
                <div key={i} style={{ padding: "18px 22px", borderBottom: i < 4 ? "1px solid var(--line)" : "none", display: "flex", gap: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--cream-deep)", color: a.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name={a.icon} size={16}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontWeight: 500 }}>{a.title}</div>
                      <div className="tiny">{a.time}</div>
                    </div>
                    <div className="small muted" style={{ marginTop: 4, lineHeight: 1.5 }}>{a.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="col" style={{ gap: 16 }}>
            {/* Memorial */}
            <div className="card card-pad" style={{ background: "linear-gradient(180deg, #fbf6e8 0%, var(--cream) 100%)" }}>
              <div className="eyebrow eyebrow--rust">{t("In memoriam")}</div>
              <div className="serif" style={{ fontSize: 22, fontStyle: "italic", marginTop: 12 }}>{t("For Eeva Karjalainen")}</div>
              <p className="small" style={{ marginTop: 8, color: "var(--ink-soft)" }}>{t("1948 - 2023 · Who loved the lady's-slipper.")}</p>
              <div style={{ marginTop: 16, padding: 14, background: "var(--paper)", borderRadius: 8, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                <Icon name="quote" size={13} style={{ color: "var(--rust)", marginRight: 6 }}/>
                <i>{t("Cypripedium calceolus, bed 7 · Annual bloom alert sent each May to Eeva's family.")}</i>
              </div>
              <button className="btn btn-ghost small" style={{ marginTop: 12, padding: "6px 0" }}>{t("Manage memorial →")}</button>
            </div>

            {/* Gifts sent */}
            <div className="card card-pad">
              <div className="eyebrow">{t("Gifts you've sent")}</div>
              <div className="col" style={{ marginTop: 14, gap: 12 }}>
                {[
                  { to: "Aino Niemi", plant: "Trollius europaeus", date: "Jun 2025", status: t("Opened") },
                  { to: "Luokka 5A - Oulun normaalikoulu", plant: "Saxifraga hirculus", date: "Sept 2024", status: t("Active") }
                ].map((g, i) => (
                  <div key={i} style={{ padding: 12, background: "var(--cream-deep)", borderRadius: 8, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 500 }}>{g.to}</span>
                      <span className="badge badge-nt">{g.status}</span>
                    </div>
                    <div className="small muted" style={{ marginTop: 4 }}><i>{g.plant}</i> · {g.date}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tax */}
            <div className="card card-pad" style={{ background: "var(--paper)" }}>
              <div className="eyebrow">{t("2025 tax certificate")}</div>
              <div className="serif" style={{ fontSize: 24, marginTop: 8 }}>€430.00</div>
              <p className="small muted" style={{ marginTop: 6 }}>{t("Auto-generated for the prior tax year · TVL §57 reference included.")}</p>
              <button className="btn btn-secondary small" style={{ marginTop: 12 }}>{t("Download PDF")}</button>
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
};

window.GardenScreen = GardenScreen;
