// AskTheGarden - RAG-grounded chat with citations

const AskScreen = ({ onNav, onOpenPlant }) => {
  const { t, lang, setLang } = useT();
  const [messages, setMessages] = React.useState([
    {
      role: "assistant",
      type: "intro"
    }
  ]);
  const [input, setInput] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const [mode, setMode] = React.useState("visitor");
  const scrollRef = React.useRef(null);

  const sendQuestion = (q) => {
    if (!q.trim()) return;
    setMessages(m => [...m, { role: "user", text: q }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMessages(m => [...m, buildAnswer(q, t)]);
    }, 1100);
  };

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "300px 1fr 320px", height: "calc(100vh - 65px)", overflow: "hidden" }}>
      {/* LEFT - sessions / suggestions */}
      <aside style={{ borderRight: "1px solid var(--line-soft)", background: "var(--paper)", padding: "24px 0", overflowY: "auto" }}>
        <div style={{ padding: "0 20px" }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", padding: 4, background: "rgba(31,58,44,0.06)", borderRadius: 999 }}>
            {[
              { id: "visitor", label: t("Visitor") },
              { id: "staff", label: t("Staff") }
            ].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                flex: 1, padding: "8px 0", borderRadius: 999, fontSize: 13,
                background: mode === m.id ? "var(--paper)" : "transparent",
                color: mode === m.id ? "var(--ink)" : "var(--ink-3)",
                boxShadow: mode === m.id ? "var(--shadow-sm)" : "none",
                fontWeight: 500
              }}>{m.label}</button>
            ))}
          </div>

          <button className="btn btn-secondary btn-block" style={{ marginTop: 16 }}>
            <Icon name="plus" size={14}/> {t("New conversation")}
          </button>

          <div className="tiny" style={{ marginTop: 28, marginBottom: 12 }}>{mode === "visitor" ? t("Trending today") : t("Quick staff actions")}</div>
          {(mode === "visitor" ? TRENDING_QUESTIONS : [
            "Draft school-tour script for yläkoulu (Saxifraga hirculus)",
            "Generate signage text - Trollius europaeus (FI/SV/EN)",
            "Summarise this quarter's gardener notes",
            "Find a Kone Foundation grant template",
            "Identify a herbarium sample (image upload)"
          ]).map((q, i) => (
            <button key={i} onClick={() => sendQuestion(q)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
              borderRadius: 10, fontSize: 13, color: "var(--ink-2)", marginBottom: 4,
              background: "transparent", lineHeight: 1.4
            }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(31,58,44,0.05)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {t(q)}
            </button>
          ))}

          <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: 24, paddingTop: 20 }}>
            <div className="tiny" style={{ marginBottom: 12 }}>{t("Recent")}</div>
            {[ t("What's blooming this week?") , t("How is Pulsatilla doing?"), t("Adopters' Day - when?")].map((q, i) => (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.4 }}>
                {q}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* CENTER - chat */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, background: "var(--bg)" }}>
        {/* Header */}
        <div style={{ padding: "16px 32px", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--forest)", color: "var(--lichen)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="leaf" size={18}/>
            </div>
            <div>
              <div className="serif" style={{ fontSize: 20 }}>{t("AskTheGarden")}</div>
              <div className="tiny" style={{ textTransform: "none", fontFamily: "Geist", letterSpacing: 0 }}>{t("Grounded in 4 213 accessions · 287 publications · ")}{mode === "staff" ? t("Staff mode") : t("Visitor mode")}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="lang-pill">
              {["FI", "SV", "EN"].map(l => (
                <button key={l} onClick={() => setLang(l)} className={lang === l ? "active" : ""}>{l}</button>
              ))}
            </div>
            <button className="icon-btn" title="Voice mode"><Icon name="mic" size={16}/></button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "32px 0" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 32px" }}>
            {messages.map((m, i) => <MessageBubble key={i} m={m} onOpenPlant={onOpenPlant}/>)}
            {thinking && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--forest)", color: "var(--lichen)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="leaf" size={14}/>
                </div>
                <div style={{ background: "var(--paper)", borderRadius: 16, padding: "14px 20px", display: "flex", gap: 6 }}>
                  {[0, 1, 2].map(d => (
                    <span key={d} style={{
                      width: 8, height: 8, borderRadius: "50%", background: "var(--moss)",
                      animation: `pulse 1.2s ${d * 0.15}s infinite ease-in-out`
                    }}/>
                  ))}
                </div>
              </div>
            )}
            <style>{`@keyframes pulse { 0%, 60%, 100% { transform: scale(0.8); opacity: 0.5; } 30% { transform: scale(1.2); opacity: 1; } }`}</style>
          </div>
        </div>

        {/* Composer */}
        <div style={{ padding: "20px 32px 28px", borderTop: "1px solid var(--line-soft)", background: "var(--bg)", flexShrink: 0 }}>
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <form onSubmit={e => { e.preventDefault(); sendQuestion(input); }} style={{ display: "flex", gap: 10, padding: 10, background: "var(--paper)", borderRadius: 18, border: "1px solid var(--line)", boxShadow: "var(--shadow-sm)" }}>
              <button type="button" className="icon-btn" title="Upload a plant photo (forwarded to Pl@ntNet)" style={{ flexShrink: 0 }}><Icon name="plus" size={16}/></button>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={mode === "staff" ? t("Ask for grant text, signage, school scripts…") : t("Ask about a plant, the garden, conservation work…")}
                style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 15, color: "var(--ink)" }}
              />
              <button type="button" className="icon-btn" title="Voice input"><Icon name="mic" size={16}/></button>
              <button type="submit" className="btn btn-primary" style={{ padding: "0 16px" }} disabled={!input.trim()}>
                <Icon name="send" size={14}/>
              </button>
            </form>
            <div className="tiny" style={{ textAlign: "center", marginTop: 12, textTransform: "none", letterSpacing: 0, fontFamily: "Geist", color: "var(--ink-3)" }}>
              {t("Every answer cites its source. Confidence threshold: 85%. Below that, we'll offer to email the question to Curator Anna Liisa Ruotsalainen.")}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT - context */}
      <aside style={{ borderLeft: "1px solid var(--line-soft)", background: "var(--paper)", overflowY: "auto", padding: 24 }}>
        <div className="tiny">{t("Context · what's grounding this")}</div>
        <h3 className="serif" style={{ fontSize: 22, marginTop: 8 }}>{t("Live corpus")}</h3>

        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { label: t("Oulu accession DB"), n: "4 213", desc: t("Plants in the living collection") },
            { label: t("Biodiversity Unit papers"), n: "287", desc: t("Ann. Bot. Fenn., Memoranda, etc.") },
            { label: t("LIFE+ ESCAPE outputs"), n: "12", desc: t("Reports & datasets") },
            { label: t("BGCI / GBIF cross-refs"), n: "1 247", desc: t("External occurrence records") }
          ].map(s => (
            <div key={s.label} style={{ padding: 14, background: "var(--bg)", borderRadius: 12 }}>
              <div className="tiny">{s.label}</div>
              <div className="serif" style={{ fontSize: 24, marginTop: 4 }}>{s.n}</div>
              <div className="small muted" style={{ marginTop: 2 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28, padding: 16, background: "var(--bg)", borderRadius: 12 }}>
          <div className="tiny" style={{ color: "var(--rust)" }}>{t("Out-of-domain policy")}</div>
          <p className="small" style={{ marginTop: 8, color: "var(--ink-2)", lineHeight: 1.6 }}>
            {t("If you ask about a plant not in our collection, we link out to BGCI PlantSearch or GBIF. For image ID, we forward to Pl@ntNet and verify against our accessions.")}
          </p>
        </div>

        <div style={{ marginTop: 16, padding: 16, background: "rgba(184,92,60,0.08)", borderRadius: 12 }}>
          <div className="tiny" style={{ color: "var(--rust)" }}>{t("Last curator audit")}</div>
          <div className="small" style={{ marginTop: 8, color: "var(--ink-2)" }}>
            <b>{t("2.1% error rate")}</b> {t("across 200-question test set. Below 5% threshold for public launch. Re-audited monthly.")}
          </div>
        </div>
      </aside>
    </div>
  );
};

const MessageBubble = ({ m, onOpenPlant }) => {
  const { t, lang } = useT();
  if (m.type === "intro") {
    return (
      <div style={{ display: "flex", gap: 14, marginBottom: 32 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--forest)", color: "var(--lichen)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="leaf" size={16}/>
        </div>
        <div style={{ flex: 1 }}>
          <div className="serif" style={{ fontSize: 32, fontStyle: "italic", color: "var(--forest)" }}>{t("Tervetuloa.")}</div>
          <p style={{ marginTop: 12, fontSize: 16, lineHeight: 1.6, color: "var(--ink-2)" }}>
            {t("I'm AskTheGarden - the University of Oulu Botanical Garden's voice. I'm grounded in our accession database, the Biodiversity Unit's publications, and the LIFE+ ESCAPE conservation programme.")}
          </p>
          <p style={{ marginTop: 12, fontSize: 14, color: "var(--ink-3)", lineHeight: 1.6 }}>
            {t("I differ from Pl@ntNet, iNaturalist, or general chatbots because I know Oulu. Every answer shows its source. If I'm not sure, I'll say so and offer to forward your question to Curator Anna Liisa Ruotsalainen.")}
          </p>
        </div>
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "end", marginBottom: 20 }}>
        <div style={{ maxWidth: "75%", padding: "14px 18px", background: "var(--forest)", color: "var(--paper)", borderRadius: 18, borderBottomRightRadius: 4 }}>
          {m.text}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--forest)", color: "var(--lichen)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name="leaf" size={16}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Citations first */}
        {m.citations && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {m.citations.map(c => (
              <button key={c.id} className="pill" style={{ padding: "6px 12px", fontSize: 12, background: "var(--paper)", border: "1px solid var(--line)" }}>
                <Icon name="quote" size={11}/> <span style={{ fontFamily: "Geist Mono", fontSize: 11 }}>{c.id}</span> <span className="muted">{c.source}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ background: "var(--paper)", borderRadius: 18, padding: "16px 20px", borderBottomLeftRadius: 4 }}>
          {m.body}
          {/* Cards */}
          {m.cards && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 16 }}>
              {m.cards.map(c => {
                const pRaw = PLANTS.find(p => p.id === c);
                if (!pRaw) return null;
                const p = localisePlant(pRaw, lang);
                return (
                  <button key={c} onClick={() => onOpenPlant(p.id)} className="card" style={{ padding: 10, display: "flex", gap: 10, alignItems: "center", textAlign: "left", border: "1px solid var(--line)" }}>
                    <div style={{ width: 44, height: 54, borderRadius: 8, background: p.accent, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Botanical color={p.color} accent={p.accent} variant={p.variant} style={{ width: 36, height: 46 }}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="serif" style={{ fontSize: 15, fontStyle: "italic" }}>{p.name}</div>
                      <div className="tiny" style={{ marginTop: 2 }}>{p.fi} · {p.rarity}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="pill small" style={{ padding: "4px 10px" }}>👍 Helpful</button>
          <button className="pill small" style={{ padding: "4px 10px" }}>👎 Off-base</button>
          <button className="pill small" style={{ padding: "4px 10px" }}>📧 Forward to curator</button>
          <button className="pill small" style={{ padding: "4px 10px" }}>🔖 Save</button>
        </div>
      </div>
    </div>
  );
};

// Pre-canned answers - t is passed in for i18n
function buildAnswer(q, t) {
  const ql = q.toLowerCase();
  if (ql.includes("bloom") || ql.includes("blooming")) {
    return {
      role: "assistant",
      citations: [ASK_CITATIONS[2]],
      body: (
        <>
          <p>{t("This week (May 12 – May 18, 2026), three plants are in active bloom:")}</p>
          <ul style={{ marginTop: 10, paddingLeft: 20, color: "var(--ink-2)" }}>
            <li><b>Pulsatilla patens</b> - {t("south slope, peak bloom expected through Sunday")}</li>
            <li><b>Primula nutans</b> - {t("Bothnian Bay bed, first flush")}</li>
            <li><b>Trollius europaeus</b> - {t("meadow bed 4, ~30% open")}</li>
          </ul>
          <p style={{ marginTop: 12 }} className="small muted">{t("Based on Head Gardener Tuomas Kauppila's note from May 10. Greenhouse Victoria water lily not yet blooming - August evenings.")}</p>
        </>
      ),
      cards: ["puls-pat", "prim-nut"]
    };
  }
  if (ql.includes("endangered") || ql.includes("critically")) {
    return {
      role: "assistant",
      citations: [ASK_CITATIONS[3], ASK_CITATIONS[1]],
      body: (
        <>
          <p>{t("The garden holds 6 species assessed as Critically Endangered (CR) or Endangered (EN) in the 2019 Finnish Red List. Among these,")} <b>Pulsatilla patens</b> {t("is CR;")} <b>Saxifraga hirculus</b> {t("and")} <b>Primula nutans</b> {t("are EN.")}</p>
          <p style={{ marginTop: 12 }}>{t("All three are part of the Garden's contribution to the LIFE+ ESCAPE programme (2012–2017), which lifted ex-situ coverage of Finnish threatened plants from 11% to 56%.")}</p>
        </>
      ),
      cards: ["puls-pat", "saxi-hirc"]
    };
  }
  if (ql.includes("water lily") || ql.includes("victoria")) {
    return {
      role: "assistant",
      citations: [ASK_CITATIONS[2]],
      body: (
        <>
          <p>{t("The")} <b>Victoria amazonica</b> {t("in Romeo greenhouse blooms in")} <b>{t("August evenings")}</b> {t("only - the white flowers open at dusk and turn pink overnight. Bloom evenings are typically Tuesday–Sunday once flowering begins; we announce specific dates 48h ahead.")}</p>
          <p style={{ marginTop: 12 }} className="small muted">{t("Cultivated here since 1972; leaves currently 1.8 m across.")}</p>
        </>
      ),
      cards: ["vict-am"]
    };
  }
  if (ql.includes("ladys") || ql.includes("lady") || ql.includes("orchid")) {
    return {
      role: "assistant",
      citations: [ASK_CITATIONS[2], ASK_CITATIONS[3]],
      body: (
        <>
          <p>{t("The")} <b>Cypripedium calceolus</b> (tikankontti) {t("is in bed 7 of the outdoor garden, west of the Romeo greenhouse. Currently flowering - late May through mid-June.")}</p>
          <p style={{ marginTop: 12 }}>{t("The specimen came from Kuusamo in 1995; the species is Vulnerable in Finland and strictly protected. Please don't touch the flowers.")}</p>
        </>
      ),
      cards: ["cyp-cal"]
    };
  }
  if (ql.includes("life+") || ql.includes("escape") || ql.includes("seed bank")) {
    return {
      role: "assistant",
      citations: [ASK_CITATIONS[1]],
      body: (
        <>
          <p>{t("The")} <b>LIFE+ ESCAPE</b> {t("project (LIFE11 BIO/FI/000917, 2012–2017) was a national programme on ex-situ conservation of Finnish native plants.")}</p>
          <p style={{ marginTop: 12 }}>{t("Headline results: ~1.7 million high-quality seeds collected, 175 taxa sampled in the field, 148 taxa banked in the Finnish national seed bank. Ex-situ coverage of threatened Finnish vascular plants rose from 11% to 56%.")}</p>
          <p style={{ marginTop: 12 }}>{t("Oulu Botanical Garden was a partner. Adoption funds the next chapter - partnership with the Finnish Museum of Natural History (Luomus) continues.")}</p>
        </>
      )
    };
  }
  return {
    role: "assistant",
    citations: [ASK_CITATIONS[0]],
    body: (
      <>
        <p>{t("That's outside what I can confidently answer from the Garden's corpus. I can give you a general response, or I can forward your question to Curator Anna Liisa Ruotsalainen - typical reply within 2 working days.")}</p>
        <p className="small muted" style={{ marginTop: 12 }}>{t("If you're identifying a plant from a photo, I can also pass it through Pl@ntNet and check the result against our accessions.")}</p>
      </>
    )
  };
}

window.AskScreen = AskScreen;
