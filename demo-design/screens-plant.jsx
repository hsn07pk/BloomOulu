// Plant detail - the QR scan experience

// "Endangered Finnish Natives" trail = all CR/EN/VU plants in PLANTS order
const TRAIL_IDS = PLANTS.filter(p => ["CR","EN","VU"].includes(p.rarity)).map(p => p.id);

const PlantScreen = ({ plantId, onBack, onNav, onAdopt }) => {
  const { t, lang } = useT();
  const plantRaw = PLANTS.find(p => p.id === plantId) || PLANTS[0];
  const plant = localisePlant(plantRaw, lang);
  const trailIdx = TRAIL_IDS.indexOf(plant.id);
  const onTrail = trailIdx >= 0;
  const nextTrailId = onTrail ? TRAIL_IDS[(trailIdx + 1) % TRAIL_IDS.length] : TRAIL_IDS[0];
  const { isSaved, toggle: toggleSaved } = useSavedPlants();
  const isPlantSaved = isSaved(plant.id);
  const { stickers, collect: collectSticker, has: hasSticker } = useStickerCollection();
  const [readingLevel, setReadingLevel] = React.useState("middle"); // primary / middle / upper
  const [quizOpen, setQuizOpen] = React.useState(false);
  const [showMap, setShowMap] = React.useState(false);
  const [showQR, setShowQR] = React.useState(false);

  React.useEffect(() => {
    if (!showMap) return;
    const onKey = (e) => { if (e.key === "Escape") setShowMap(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showMap]);
  const [audioPlaying, setAudioPlaying] = React.useState(false);
  const [audioCurrent, setAudioCurrent] = React.useState(0);
  const [audioDuration, setAudioDuration] = React.useState(0);
  const [captionsOn, setCaptionsOn] = React.useState(
    typeof window !== "undefined" && window.localStorage && localStorage.getItem("bloom_captions") === "1"
  );
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem("bloom_captions", captionsOn ? "1" : "0");
    }
  }, [captionsOn]);
  const [tab, setTab] = React.useState("story");
  const [season, setSeason] = React.useState("summer");
  const [mode, setMode] = React.useState("adult");
  const audioRef = React.useRef(null);

  // Reset audio when the plant or language changes (audio source becomes a new file)
  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    // Reload so the new src is fetched
    try { a.load(); } catch {}
    setAudioPlaying(false);
    setAudioCurrent(0);
    setAudioDuration(0);
  }, [plant.id, lang]);

  // Pick localised transcript + audio path
  const langKey = (lang || "EN").toLowerCase();
  const transcript = (plant.transcript && typeof plant.transcript === "object")
    ? (plant.transcript[langKey] || plant.transcript.en)
    : plant.transcript;
  const audioSrc = `audio/${langKey}/${plant.id}.m4a`;

  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setAudioPlaying(true)).catch(() => setAudioPlaying(false));
    } else {
      a.pause();
      setAudioPlaying(false);
    }
  };
  const fmtTime = (s) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  const audioProgress = audioDuration > 0 ? (audioCurrent / audioDuration) * 100 : 0;

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
          <button className="btn btn-ghost small" onClick={onBack} aria-label={t("Back")}><Icon name="back" size={14}/> {t("Back")}</button>
          <span className="tiny">{t("Scanned via QR · ")}{plant.accession}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              className="icon-btn"
              aria-label={t("Show QR code for this plant")}
              onClick={() => setShowQR(true)}
              title={t("Show QR code for this plant")}
            ><Icon name="qr" size={16}/></button>
            <button
              className="icon-btn"
              aria-label={isPlantSaved ? t("Remove bookmark") : t("Save to My Garden")}
              aria-pressed={isPlantSaved}
              onClick={() => {
                const nowSaved = toggleSaved(plant.id);
                showToast(nowSaved ? t("Saved to My Garden") : t("Removed from My Garden"));
              }}
              style={{
                background: isPlantSaved ? "var(--forest-deep)" : "var(--paper)",
                color: isPlantSaved ? "var(--sage-bright)" : "var(--ink-soft)",
                borderColor: isPlantSaved ? "var(--forest-deep)" : "var(--line)"
              }}
            >
              <Icon name="bookmark" size={16} style={isPlantSaved ? { fill: "currentColor" } : undefined}/>
            </button>
            <button
              className="icon-btn"
              aria-label={t("Share this plant")}
              onClick={async () => {
                const r = await sharePlant(plant);
                if (r.mode === "shared") showToast(t("Shared"));
                else if (r.mode === "copied") showToast(t("Link copied to clipboard"));
                else if (r.mode === "failed") showToast(t("Could not share"));
              }}
            ><Icon name="share" size={16}/></button>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 64, display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 48 }}>
        {/* LEFT - content */}
        <div>
          {/* Hero */}
          <div className="card" style={{ background: plant.accent, padding: 0, overflow: "hidden", borderRadius: 24, position: "relative", aspectRatio: "16/10" }}>
            <PlantImage plant={plant} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}/>
            <div style={{ position: "absolute", top: 20, left: 20, right: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <RarityBadge rarity={plant.rarity} label={plant.rarityLabel}/>
              <span className="badge" style={{ background: "rgba(255,255,255,0.7)", color: "var(--ink-2)" }}>{plant.family}</span>
            </div>
            <div style={{ position: "absolute", bottom: 20, left: 20, right: 20, display: "flex", alignItems: "end", justifyContent: "space-between" }}>
              <div style={{ background: "rgba(255,255,255,0.92)", padding: "12px 16px", borderRadius: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <audio
                  ref={audioRef}
                  key={audioSrc}
                  src={audioSrc}
                  preload="metadata"
                  onLoadedMetadata={e => setAudioDuration(e.currentTarget.duration)}
                  onTimeUpdate={e => setAudioCurrent(e.currentTarget.currentTime)}
                  onEnded={() => { setAudioPlaying(false); setAudioCurrent(0); }}
                />
                <button onClick={toggleAudio} className="btn btn-primary" style={{ width: 44, height: 44, padding: 0, borderRadius: "50%" }} aria-label={audioPlaying ? t("Pause") : t("Play")}>
                  <Icon name={audioPlaying ? "pause" : "play"} size={16}/>
                </button>
                <div style={{ minWidth: 180 }}>
                  <div className="tiny" style={{ color: "var(--ink-2)" }}>{t("Audio narration · Garden voice")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <div style={{ flex: 1, height: 4, background: "rgba(31,58,44,0.12)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${audioProgress}%`, height: "100%", background: "var(--forest)" }}/>
                    </div>
                    <span className="mono small" style={{ color: "var(--ink-2)" }}>
                      {fmtTime(audioCurrent)} / {fmtTime(audioDuration || 0)}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="icon-btn"
                  style={{ background: captionsOn ? "var(--forest)" : "rgba(255,255,255,0.92)", color: captionsOn ? "var(--cream)" : "var(--ink-2)", borderColor: captionsOn ? "var(--forest)" : "var(--line)" }}
                  onClick={() => setCaptionsOn(c => !c)}
                  aria-pressed={captionsOn}
                  aria-label={captionsOn ? t("Hide captions") : t("Show captions")}
                  title={captionsOn ? t("Hide captions") : t("Show captions")}
                >
                  <span aria-hidden="true" style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700 }}>CC</span>
                </button>
              </div>
            </div>
          </div>

          {/* Captions / transcript - toggled by the CC button on the hero */}
          {captionsOn && transcript && (
            <div
              role="region"
              aria-label={t("Audio transcript")}
              style={{ marginTop: 18, padding: "16px 20px", background: "var(--forest-deep)", color: "var(--cream)", borderRadius: 14, fontSize: 15, lineHeight: 1.6, position: "relative" }}
            >
              <div className="tiny" style={{ color: "var(--sage-bright)", marginBottom: 8, letterSpacing: "0.12em" }}>
                {audioPlaying ? `▶ ${t("Now playing")}` : t("Transcript")} · {lang}
              </div>
              <p lang={langKey} style={{ margin: 0, color: "rgba(250,247,238,0.92)" }}>{transcript}</p>
            </div>
          )}

          {/* Title block */}
          <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "start", gap: 32 }}>
            <div>
              <div className="tiny" style={{ color: "var(--rust)" }}>{plant.fi} · {plant.sv}</div>
              <h1 className="serif" style={{ fontSize: 64, fontStyle: "italic", marginTop: 8, lineHeight: 1 }}>{plant.name}</h1>
              <div className="muted" style={{ marginTop: 12, fontSize: 16 }}>{plant.en} · {plant.family}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "end" }}>
              <button
                className="pill"
                style={{ cursor: "pointer", border: 0 }}
                onClick={() => setShowMap(true)}
                aria-label={t("Show on map")}
              ><Icon name="map" size={13}/> {t(plant.origin)}</button>
              <div className="pill"><Icon name="calendar" size={13}/> {t("Blooms")} {t(plant.bloom)}</div>
            </div>
          </div>

          {/* Mode-specific intro */}
          {mode === "child" ? (
            <KidModeIntro plant={plant} t={t} collectSticker={collectSticker} hasSticker={hasSticker(plant.id)} stickers={stickers}/>
          ) : mode === "school" ? (
            <SchoolModeIntro plant={plant} t={t} readingLevel={readingLevel} setReadingLevel={setReadingLevel} onQuiz={() => setQuizOpen(true)} onNav={onNav}/>
          ) : (
            <div style={{ marginTop: 32, padding: "24px 28px", background: "var(--paper)", borderRadius: 18, borderLeft: `3px solid ${plant.color}` }}>
              <Icon name="quote" size={16} style={{ color: plant.color }}/>
              <p className="serif" style={{ fontSize: 22, lineHeight: 1.4, marginTop: 8, color: "var(--ink)" }}>
                {plant.story}
              </p>
            </div>
          )}

          {/* Quick facts */}
          <div className="plant-quickfacts" data-grid-mobile="2" style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderTop: "1px solid var(--line-soft)", borderBottom: "1px solid var(--line-soft)" }}>
            {plant.quickFacts.map(([k, v], i) => (
              <div key={i} style={{ padding: "20px 24px 20px 0", borderRight: i < 3 ? "1px solid var(--line-soft)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
                <div className="tiny">{t(k)}</div>
                <div className="serif" style={{ fontSize: 22, marginTop: 6 }}>{t(v)}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="plant-tabs" style={{ marginTop: 40, display: "flex", gap: 4, borderBottom: "1px solid var(--line-soft)" }}>
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
                <button
                  className="btn btn-secondary"
                  style={{ alignSelf: "start", marginTop: 12 }}
                  onClick={() => onNav("ask", null, plant.id)}
                >
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
                {(() => {
                  const seasonalSrc = plant.seasons && plant.seasons[season];
                  const hasSeasonalAlt = seasonalSrc && seasonalSrc !== plant.image;
                  const captions = {
                    spring: hasSeasonalAlt ? t("First leaves emerge") : t("Early growth - out of bloom"),
                    summer: t("Peak bloom"),
                    autumn: hasSeasonalAlt ? t("Setting seed") : t("Post-bloom"),
                    winter: t("Under the snow")
                  };
                  if (season === "winter") {
                    return (
                      <>
                        <div style={{ aspectRatio: "16/9", borderRadius: 14, background: "linear-gradient(180deg, #e7ecf0 0%, #cbd4d8 100%)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          <Botanical color="#9DA8B4" accent="#cbd4d8" variant={plant.variant} style={{ width: "45%", height: "70%" }}/>
                        </div>
                        <div style={{ marginTop: 18, padding: 16, background: "#f0f3f5", borderRadius: 12, fontSize: 14, color: "var(--ink-2)" }}>
                          <Icon name="snow" size={14} style={{ verticalAlign: "middle", marginRight: 6, color: "var(--sky)" }}/>
                          {t("Under the snow now. What's happening below: rhizomes are dormant, mycorrhizal partners still active. Outdoor garden is closed for maintenance - visit Romeo & Julia year-round.")}
                        </div>
                      </>
                    );
                  }
                  return (
                    <>
                      <div style={{ aspectRatio: "16/9", borderRadius: 14, background: plant.accent, overflow: "hidden", position: "relative" }}>
                        <img
                          src={seasonalSrc || plant.image}
                          alt={`${plant.name} - ${season}`}
                          loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: hasSeasonalAlt ? "none" : (season === "spring" ? "saturate(0.85) brightness(1.06)" : season === "autumn" ? "sepia(0.18) saturate(1.1) hue-rotate(-8deg)" : "none") }}
                        />
                        {!hasSeasonalAlt && (
                          <div style={{ position: "absolute", top: 14, right: 14, padding: "6px 12px", background: "rgba(31,58,44,0.78)", color: "var(--cream)", borderRadius: 999, fontSize: 11, fontFamily: "var(--f-mono)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                            {t("Stock photo")}
                          </div>
                        )}
                      </div>
                      <div className="small muted" style={{ marginTop: 12, textAlign: "center", fontStyle: "italic" }}>
                        {captions[season]}{plant.bloom ? ` · ${t("Blooms")} ${t(plant.bloom)}` : ""}
                      </div>
                    </>
                  );
                })()}
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
          {onTrail && (
            <div style={{ marginTop: 40, padding: "20px 24px", background: "var(--forest)", color: "var(--paper)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div className="tiny" style={{ color: "var(--lichen)" }}>{t("You're on the trail")}</div>
                <div className="serif" style={{ fontSize: 26, marginTop: 4 }}>{t("Endangered Finnish Natives")}</div>
                <div className="small" style={{ color: "rgba(248,244,230,0.7)", marginTop: 4 }}>
                  {t("Stop")} {trailIdx + 1} / {TRAIL_IDS.length}
                </div>
              </div>
              <button
                className="btn"
                style={{ background: "var(--paper)", color: "var(--forest)" }}
                onClick={() => onNav("plant", nextTrailId)}
                aria-label={t("Go to next stop on the trail")}
              >
                {t("Next stop")} <Icon name="arrow" size={14}/>
              </button>
            </div>
          )}
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
                  <div className="serif" style={{ fontSize: 40 }}>€{plant.rarity === "CR" || plant.rarity === "EN" ? 750 : plant.rarity === "VU" ? 250 : 75}<span style={{ fontSize: 14, color: "var(--ink-3)" }}>/yr</span></div>
                  <div className="small muted">{plant.rarity === "CR" || plant.rarity === "EN" ? t("Endangered tier") : plant.rarity === "VU" ? t("Vulnerable tier") : t("Rooted tier")}</div>
                </div>
                <div className="small" style={{ color: "var(--ink-2)", marginTop: 6 }}>{plant.rarity === "CR" || plant.rarity === "EN" ? t("Plaque next to YOUR plant · annual seed packet") : plant.rarity === "VU" ? t("Signed botanical art · Adopters' Open Day + guest") : t("Printed certificate · seasonal photos")}</div>
              </div>

              <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} onClick={() => onAdopt(plant.id, "self")}>
                <Icon name="seedling" size={16}/> {t("Adopt this plant")}
              </button>
              <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => onAdopt(plant.id, "gift")}>
                <Icon name="gift" size={14}/> {t("Adopt as a gift")}
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost small" style={{ flex: 1, border: "1px solid var(--line)" }} onClick={() => onAdopt(plant.id, "memorial")}>
                  <Icon name="heart" size={13}/> {t("Memorial")}
                </button>
                <button className="btn btn-ghost small" style={{ flex: 1, border: "1px solid var(--line)" }} onClick={() => onAdopt(plant.id, "class")}>
                  <Icon name="school" size={13}/> {t("Class")} · €50
                </button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--line-soft)", padding: 20, background: "rgba(31,58,44,0.03)" }}>
              <div className="tiny">{t("Where your money goes")}</div>
              <div className="small" style={{ marginTop: 8, color: "var(--ink-2)" }}>{t("Of every €100: €62 direct ex-situ work, €18 to Luomus seed bank, €12 garden operations, €8 platform.")}</div>
              <button className="btn btn-ghost small" style={{ marginTop: 8, padding: "6px 0" }} onClick={() => openFundsFlow()}>{t("Read the policy →")}</button>
            </div>
          </div>

          {/* Similar plants */}
          <div style={{ marginTop: 24 }}>
            <div className="tiny">{t("Similar plants")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {PLANTS.filter(p => p.id !== plant.id && p.family === plant.family).slice(0, 2).concat(PLANTS.filter(p => p.id !== plant.id).slice(0, 2)).slice(0, 3).map(p => (
                <button key={p.id} onClick={() => onNav("plant", p.id)} className="card" style={{ display: "flex", gap: 12, padding: 12, alignItems: "center", textAlign: "left" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 8, background: p.accent, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    <PlantImage plant={p} style={{ width: "100%", height: "100%" }}/>
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

      {/* Quiz modal - School mode */}
      {quizOpen && <QuizModal plant={plant} t={t} onClose={() => setQuizOpen(false)}/>}

      {/* QR code modal - shareable deep link for this plant */}
      {showQR && (
        <div
          onClick={() => setShowQR(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t("QR code")}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,10,7,0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--cream)", color: "var(--ink)", borderRadius: 18, padding: 24, maxWidth: 380, width: "100%", boxShadow: "var(--shadow-deep)", position: "relative", textAlign: "center" }}
          >
            <button onClick={() => setShowQR(false)} className="icon-btn" aria-label={t("Close")} style={{ position: "absolute", top: 14, right: 14 }}>
              <Icon name="close" size={14}/>
            </button>
            <div className="eyebrow" style={{ justifyContent: "center" }}>{t("QR code")}</div>
            <h3 className="serif" style={{ fontSize: 22, marginTop: 8, fontStyle: "italic" }}>{plant.name}</h3>
            <div className="small muted" style={{ marginTop: 4 }}>{plant.accession}</div>
            <div style={{ marginTop: 18, padding: 16, background: "var(--paper)", borderRadius: 12, border: "1px solid var(--line)", display: "inline-block" }}>
              <QRCode value={plantDeepLink(plant.id)} size={220} ecLevel="H"/>
            </div>
            <p className="small muted" style={{ marginTop: 14, lineHeight: 1.5 }}>
              {t("Print this on the plant's physical label. Visitors scan it with their phone camera to open this exact page.")}
            </p>
            <div style={{ marginTop: 16, padding: 10, background: "rgba(31,58,44,0.06)", borderRadius: 8, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)", wordBreak: "break-all" }}>
              {plantDeepLink(plant.id)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-secondary small" onClick={async () => {
                try { await navigator.clipboard.writeText(plantDeepLink(plant.id)); showToast(t("Link copied to clipboard")); }
                catch { showToast(t("Could not share")); }
              }}>
                <Icon name="share" size={13}/> {t("Copy link")}
              </button>
              <button className="btn btn-secondary small" onClick={() => window.print()}>
                <Icon name="info" size={13}/> {t("Print")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map overlay - opens from the origin pill */}
      {showMap && (
        <div
          onClick={() => setShowMap(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t("Garden map")}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,10,7,0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--cream)", color: "var(--ink)", borderRadius: 18, padding: 22, maxWidth: 760, width: "100%", boxShadow: "var(--shadow-deep)", position: "relative" }}
          >
            <button onClick={() => setShowMap(false)} className="icon-btn" aria-label={t("Close")} style={{ position: "absolute", top: 14, right: 14 }}>
              <Icon name="close" size={14}/>
            </button>
            <div className="eyebrow">{t("Garden map")}</div>
            <h3 className="serif" style={{ fontSize: 24, marginTop: 8, fontStyle: "italic" }}>{plant.name}</h3>
            <div className="small muted" style={{ marginTop: 4 }}>{PLANT_BED[plant.id] || t(plant.origin)}</div>
            <div style={{ marginTop: 14 }}>
              <PlantMap plant={plant} height={360}/>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <a
                href={`https://www.openstreetmap.org/?mlat=${(PLANT_COORDS && PLANT_COORDS[plant.id] || GARDEN_CENTER)[0]}&mlon=${(PLANT_COORDS && PLANT_COORDS[plant.id] || GARDEN_CENTER)[1]}&zoom=18`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary small"
              ><Icon name="map" size={14}/> {t("Open in OpenStreetMap")}</a>
              <button className="btn btn-secondary small" onClick={() => setShowMap(false)}>{t("Close")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =====================================================================
// Kid mode: plant-as-character intro + sticker collection
// =====================================================================
const KidModeIntro = ({ plant, t, collectSticker, hasSticker, stickers }) => {
  const greeted = React.useRef(false);
  React.useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    if (!hasSticker) {
      const next = collectSticker(plant.id);
      showToast(`⭐ ${t("Sticker collected!")} (${next.length}/10)`);
    }
  }, [plant.id]);
  const stickerCount = stickers.length;
  const goal = 10;
  const pct = Math.min(100, (stickerCount / goal) * 100);

  // Visit-loop badges: how many unique seasons + biomes the user has collected.
  const collectedPlants = (typeof PLANTS !== "undefined" ? PLANTS : [])
    .filter(p => stickers.includes(p.id));
  const allSeasons = ["spring", "summer", "autumn", "winter"];
  const collectedSeasons = new Set();
  collectedPlants.forEach(p => {
    if (p.bloomSeason === "all") allSeasons.forEach(s => collectedSeasons.add(s));
    else if (p.bloomSeason) collectedSeasons.add(p.bloomSeason);
  });
  const allBiomes = Array.from(new Set((typeof PLANTS !== "undefined" ? PLANTS : []).map(p => p.biome).filter(Boolean)));
  const collectedBiomes = new Set(collectedPlants.map(p => p.biome).filter(Boolean));

  const facts = [
    { emoji: "🌍", label: t("Where I'm from"), value: t(plant.origin) },
    { emoji: "🌸", label: t("When I bloom"), value: t(plant.bloom) },
    { emoji: "🛡️", label: t("How I'm doing"), value: t(plant.rarityLabel || plant.rarity) }
  ];
  return (
    <div style={{ marginTop: 24, padding: "26px 28px", background: `linear-gradient(135deg, ${plant.accent} 0%, var(--paper) 100%)`, borderRadius: 22, border: `2px solid ${plant.color}` }}>
      <div className="tiny" style={{ color: plant.color, marginBottom: 8 }}>🌱 {t("Kid mode")}</div>
      <h2 className="serif" style={{ fontSize: 30, lineHeight: 1.1, color: "var(--ink)", margin: 0 }}>
        {t("Hi! I'm")} <i>{plant.localName || plant.fi || plant.name}</i>!
      </h2>
      <p style={{ marginTop: 12, fontSize: 17, lineHeight: 1.5, color: "var(--ink-soft)" }}>
        {t("I'm a flower from")} {t(plant.origin)}. {t("Scan me to add me to your sticker book.")}
      </p>

      {/* Sticker collection */}
      <div style={{ marginTop: 18, padding: 14, background: "rgba(250,247,238,0.7)", borderRadius: 14, border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span className="small" style={{ fontWeight: 600 }}>⭐ {t("Your sticker book")}</span>
          <span className="mono small">{stickerCount}/{goal}</span>
        </div>
        <div style={{ height: 8, background: "rgba(31,58,44,0.12)", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: plant.color, transition: "width 300ms" }}/>
        </div>
        <div className="tiny" style={{ marginTop: 6, textTransform: "none", letterSpacing: 0, fontFamily: "var(--f-body)" }}>
          {stickerCount >= goal ? `🏆 ${t("Done! Show this at the gift shop for your badge.")}` : `${t("Scan")} ${goal - stickerCount} ${t("more plants to win a badge!")}`}
        </div>
      </div>

      {/* Visit-loop badges: seasons + biomes collected */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} data-grid-mobile="2">
        <div style={{ padding: 12, background: "rgba(250,247,238,0.7)", borderRadius: 12, border: "1px solid var(--line)" }}>
          <div className="tiny">🍂 {t("Seasons")}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {[{ id: "spring", emoji: "🌱" }, { id: "summer", emoji: "☀️" }, { id: "autumn", emoji: "🍁" }, { id: "winter", emoji: "❄️" }].map(s => (
              <span key={s.id} title={t(s.id)} style={{
                fontSize: 18, opacity: collectedSeasons.has(s.id) ? 1 : 0.25,
                filter: collectedSeasons.has(s.id) ? "none" : "grayscale(1)",
                transition: "opacity 200ms"
              }}>{s.emoji}</span>
            ))}
          </div>
          <div className="tiny" style={{ marginTop: 6, textTransform: "none", letterSpacing: 0, fontFamily: "var(--f-body)" }}>
            {collectedSeasons.size}/4 {t("seasons collected")}
          </div>
        </div>
        <div style={{ padding: 12, background: "rgba(250,247,238,0.7)", borderRadius: 12, border: "1px solid var(--line)" }}>
          <div className="tiny">🗺 {t("Biomes")}</div>
          <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.3, color: "var(--ink-soft)" }}>
            {collectedBiomes.size > 0
              ? Array.from(collectedBiomes).slice(0, 3).map(b => b.split(" / ")[0]).join(" · ")
              : <span style={{ color: "var(--ink-mute)" }}>{t("None yet")}</span>}
          </div>
          <div className="tiny" style={{ marginTop: 6, textTransform: "none", letterSpacing: 0, fontFamily: "var(--f-body)" }}>
            {collectedBiomes.size}/{allBiomes.length} {t("biomes collected")}
          </div>
        </div>
      </div>

      {/* Fun facts */}
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr", gap: 10 }} data-grid-mobile="keep">
        {facts.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: "var(--paper)", borderRadius: 12 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{f.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tiny">{f.label}</div>
              <div className="serif" style={{ fontSize: 17, marginTop: 2 }}>{f.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =====================================================================
// School mode: reading level + quiz + worksheet
// =====================================================================
const SchoolModeIntro = ({ plant, t, readingLevel, setReadingLevel, onQuiz, onNav }) => {
  // Three reading-level retellings, generated from plant data.
  const levels = {
    primary: `${plant.name} is a ${(plant.rarityLabel || plant.rarity).toLowerCase()} plant from ${plant.origin}. It blooms in ${plant.bloom}.`,
    middle: plant.story || `${plant.name} (${plant.rarityLabel}) grows in ${plant.habitat || plant.origin}. The Oulu specimen was ${plant.accessed.toLowerCase()}.`,
    upper: `${plant.story} The Oulu accession (${plant.accession}) supports ex-situ conservation research, and is part of the LIFE+ ESCAPE programme cohort. Read the cited papers tab for the published taxonomic, distributional, and population-genetic literature.`
  };
  const printWorksheet = () => {
    const w = window.open("", "_blank");
    if (!w) { showToast(t("Pop-up blocked")); return; }
    const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${plant.name} worksheet</title>
      <style>body{font-family:Georgia,serif;max-width:680px;margin:32px auto;padding:0 24px;color:#18271E;line-height:1.5}
      h1{font-size:32px;font-style:italic}h2{font-size:18px;margin-top:24px;border-bottom:1px solid #ccc;padding-bottom:4px}
      .row{display:flex;justify-content:space-between;margin:6px 0;border-bottom:1px dashed #ddd;padding:4px 0}
      .blank{flex:1;border-bottom:1px solid #888;margin-left:8px;min-height:18px}
      .q{margin:14px 0}@media print{body{margin:0}}</style></head><body>
      <h1>${plant.name}</h1>
      <p><b>Finnish:</b> ${plant.fi} &nbsp; <b>Swedish:</b> ${plant.sv}</p>
      <h2>Quick facts</h2>
      ${plant.quickFacts.map(([k,v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("")}
      <h2>Read</h2><p>${levels.middle}</p>
      <h2>Answer</h2>
      <div class="q">1. What is the scientific name of this plant? <div class="blank"></div></div>
      <div class="q">2. When does it bloom? <div class="blank"></div></div>
      <div class="q">3. What conservation status does it have? <div class="blank"></div></div>
      <div class="q">4. Where in Finland was the Oulu specimen collected? <div class="blank"></div></div>
      <div class="q">5. Name one threat to this plant: <div class="blank"></div></div>
      <p style="margin-top:48px;font-size:11px;color:#666">BloomOulu &middot; University of Oulu Botanical Garden &middot; Accession ${plant.accession}</p>
      <script>window.onload=()=>window.print()</script></body></html>`;
    w.document.write(body);
    w.document.close();
  };
  return (
    <div style={{ marginTop: 24, padding: "22px 24px", background: "var(--paper)", borderRadius: 18, border: `2px solid var(--forest)` }}>
      <div className="tiny" style={{ color: "var(--forest)", marginBottom: 8 }}>🏫 {t("School mode")}</div>
      <h2 className="serif" style={{ fontSize: 26, lineHeight: 1.15, color: "var(--ink)", margin: 0 }}>{plant.name}</h2>
      <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
        {[
          { id: "primary", label: t("Alakoulu") },
          { id: "middle", label: t("Yläkoulu") },
          { id: "upper", label: t("Lukio") }
        ].map(l => (
          <button key={l.id} onClick={() => setReadingLevel(l.id)} className="pill" style={{
            cursor: "pointer", padding: "6px 12px", fontSize: 12,
            background: readingLevel === l.id ? "var(--forest)" : "rgba(31,58,44,0.06)",
            color: readingLevel === l.id ? "var(--paper)" : "var(--ink-2)"
          }}>{l.label}</button>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.6, color: "var(--ink-soft)" }}>{levels[readingLevel]}</p>
      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary small" onClick={onQuiz}>
          <Icon name="sparkle" size={14}/> {t("Start quiz (3 questions)")}
        </button>
        <button className="btn btn-secondary small" onClick={printWorksheet}>
          <Icon name="info" size={14}/> {t("Print worksheet")}
        </button>
        <button className="btn btn-secondary small" onClick={() => { showToast(`${t("Added to lesson plan")}: ${plant.name}`); }}>
          <Icon name="plus" size={14}/> {t("Add to lesson plan")}
        </button>
      </div>
    </div>
  );
};

// =====================================================================
// Simple 3-question quiz modal - School mode
// =====================================================================
const QuizModal = ({ plant, t, onClose }) => {
  const [step, setStep] = React.useState(0);
  const [score, setScore] = React.useState(0);
  const [picked, setPicked] = React.useState(null);
  const others = PLANTS.filter(p => p.id !== plant.id);
  const shuffle = (arr) => arr.map(x => [Math.random(), x]).sort((a,b)=>a[0]-b[0]).map(x => x[1]);
  // Stable per-modal-open
  const qs = React.useMemo(() => [
    {
      q: `${t("What is the scientific name of this plant?")}`,
      options: shuffle([plant.name, others[0].name, others[1].name, others[2].name]),
      answer: plant.name
    },
    {
      q: `${t("When does it bloom?")}`,
      options: shuffle([plant.bloom, "January", "December", "October"]),
      answer: plant.bloom
    },
    {
      q: `${t("What is its conservation status?")}`,
      options: shuffle(["CR", "EN", "VU", "NT"]),
      answer: plant.rarity
    }
  ], [plant.id]);
  const done = step >= qs.length;
  const handlePick = (opt) => {
    if (picked) return;
    setPicked(opt);
    if (opt === qs[step].answer) setScore(s => s + 1);
    setTimeout(() => { setPicked(null); setStep(s => s + 1); }, 900);
  };
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={t("Plant quiz")}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,10,7,0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--paper)", color: "var(--ink)", borderRadius: 18, padding: 24, maxWidth: 480, width: "100%", boxShadow: "var(--shadow-deep)", position: "relative" }}>
        <button onClick={onClose} className="icon-btn" aria-label={t("Close")} style={{ position: "absolute", top: 14, right: 14 }}><Icon name="close" size={14}/></button>
        <div className="tiny" style={{ color: "var(--forest)" }}>🏫 {t("Quiz")}</div>
        <h3 className="serif" style={{ fontSize: 22, marginTop: 8, fontStyle: "italic" }}>{plant.name}</h3>
        {!done ? (
          <>
            <div className="tiny" style={{ marginTop: 18 }}>{t("Question")} {step + 1} / {qs.length}</div>
            <p className="serif" style={{ fontSize: 18, marginTop: 8, color: "var(--ink)" }}>{qs[step].q}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 16 }} data-grid-mobile="keep">
              {qs[step].options.map(opt => {
                const isAnswer = opt === qs[step].answer;
                const isPicked = picked === opt;
                const showColor = picked && (isAnswer || isPicked);
                return (
                  <button key={opt} onClick={() => handlePick(opt)} disabled={!!picked} style={{
                    padding: "14px 18px", border: "1px solid var(--line)", borderRadius: 12,
                    background: showColor ? (isAnswer ? "var(--sage-pale)" : "var(--rust-soft)") : "var(--paper)",
                    color: showColor ? (isAnswer ? "var(--forest)" : "var(--rust)") : "var(--ink)",
                    textAlign: "left", cursor: picked ? "default" : "pointer", fontSize: 15,
                    transition: "all 200ms"
                  }}>{opt}{showColor && isAnswer && "  ✓"}</button>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div className="serif" style={{ fontSize: 48 }}>{score} / {qs.length}</div>
            <div className="muted" style={{ marginTop: 6 }}>
              {score === qs.length ? `🏆 ${t("Perfect!")}` : score >= 2 ? `🌱 ${t("Nice work!")}` : t("Try again - learning is fun!")}
            </div>
            <button onClick={onClose} className="btn btn-primary" style={{ marginTop: 20 }}>{t("Close")}</button>
          </div>
        )}
      </div>
    </div>
  );
};

window.PlantScreen = PlantScreen;
