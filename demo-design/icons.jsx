// Inline SVG icons (1.5 stroke style)
const Icon = ({ name, size = 18, stroke = 1.6, className = "", style = {} }) => {
  const props = {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: stroke,
    strokeLinecap: "round", strokeLinejoin: "round",
    className, style
  };
  const paths = {
    leaf: <><path d="M11 20A7 7 0 0 1 4 13c0-5 5-9 16-9 0 9-3 16-9 16Z"/><path d="M2 22c2-3 4-5 8-8"/></>,
    sprout: <><path d="M7 20h10"/><path d="M12 20V8"/><path d="M12 8c0-3-2-5-5-5 0 3 2 5 5 5Z"/><path d="M12 12c0-2 2-4 5-4 0 2-2 4-5 4Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    qr: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/><path d="M20 14v3M14 20h3M20 20h.01"/></>,
    bot: <><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M2 14h2M20 14h2"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>,
    gift: <><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13"/><path d="M7.5 8a2.5 2.5 0 1 1 0-5C9 3 12 8 12 8M16.5 8a2.5 2.5 0 1 0 0-5C15 3 12 8 12 8"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z"/>,
    play: <path d="M6 4v16l14-8L6 4Z" fill="currentColor"/>,
    pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></>,
    back: <><path d="M19 12H5"/><path d="m11 5-7 7 7 7"/></>,
    check: <path d="m5 12 4 4 10-10"/>,
    close: <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
    map: <><path d="M3 6v15l6-3 6 3 6-3V3l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></>,
    snow: <><path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z"/></>,
    sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></>,
    bookmark: <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l7-4 7 4Z"/>,
    share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    spark: <><path d="M12 2 14 9l7 2-7 2-2 7-2-7-7-2 7-2 2-7Z"/></>,
    flower: <><circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V5M12 14.5V19M9.5 12H5M14.5 12H19M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17"/></>,
    seedling: <><path d="M12 20v-7"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7Z"/><path d="M12 13c4 0 6-3 6-7-4 0-6 3-6 7Z"/></>,
    building: <><rect x="4" y="3" width="16" height="18"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    minus: <path d="M5 12h14"/>,
    bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
    school: <><path d="M3 10 12 5l9 5-9 5-9-5Z"/><path d="M6 12v5c2 1 4 2 6 2s4-1 6-2v-5"/></>,
    quote: <><path d="M7 8h4v8H5v-4c0-2 1-4 2-4ZM15 8h4v8h-6v-4c0-2 1-4 2-4Z"/></>
  };
  return <svg {...props}>{paths[name]}</svg>;
};

// BloomOulu logo - stylised five-petaled bloom with circuit veining
// Matches the brand mark: forest-green → teal → sage gradient.
const BloomMark = ({ size = 34, monochrome = false, light = false }) => {
  const c1 = monochrome ? (light ? "#A8C060" : "#2D5440") : "#2D5440";
  const c2 = monochrome ? (light ? "#E8EEDE" : "#5FB0A0") : "#5FB0A0";
  const c3 = monochrome ? (light ? "#FAF7EE" : "#88A050") : "#A8C060";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <defs>
        <linearGradient id={`bloomG-${size}`} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={c1}/>
          <stop offset="50%" stopColor={c2}/>
          <stop offset="100%" stopColor={c3}/>
        </linearGradient>
      </defs>
      <g stroke={`url(#bloomG-${size})`} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* 5 leaf petals around centre */}
        {[0, 1, 2, 3, 4].map(i => {
          const a = (i * 72 - 90) * Math.PI / 180;
          const cx = 50 + Math.cos(a) * 22;
          const cy = 50 + Math.sin(a) * 22;
          const rotate = i * 72;
          return (
            <g key={i} transform={`rotate(${rotate} 50 50)`}>
              {/* leaf outline */}
              <path d="M50 50 Q35 28 50 14 Q65 28 50 50 Z"/>
              {/* central vein */}
              <path d="M50 50 L50 16"/>
              {/* side veins with dots */}
              <path d="M50 30 L42 26"/>
              <circle cx="42" cy="26" r="1.5" fill={`url(#bloomG-${size})`}/>
              <path d="M50 30 L58 26"/>
              <circle cx="58" cy="26" r="1.5" fill={`url(#bloomG-${size})`}/>
              <path d="M50 38 L44 35"/>
              <circle cx="44" cy="35" r="1.2" fill={`url(#bloomG-${size})`}/>
              <path d="M50 38 L56 35"/>
              <circle cx="56" cy="35" r="1.2" fill={`url(#bloomG-${size})`}/>
            </g>
          );
        })}
        {/* centre node */}
        <circle cx="50" cy="50" r="2" fill={`url(#bloomG-${size})`}/>
      </g>
    </svg>
  );
};

// Botanical illustration - leaf with circuit-style veining, plant-specific
const Botanical = ({ color = "#2D5440", accent = "#A8C060", variant = 0, style = {} }) => {
  const variants = [
    // 0: tall spike
    <g key="0">
      <path d="M50 230 L50 60" stroke={color} strokeWidth="1.5"/>
      {[80, 110, 140, 170, 195].map((y, i) => (
        <g key={i}>
          <path d={`M50 ${y} Q${30-i*2} ${y+8} ${15-i*2} ${y+2}`} stroke={color} strokeWidth="1.2" fill="none"/>
          <path d={`M50 ${y} Q${70+i*2} ${y+8} ${85+i*2} ${y+2}`} stroke={color} strokeWidth="1.2" fill="none"/>
          <circle cx={15-i*2} cy={y+2} r="2" fill={color}/>
          <circle cx={85+i*2} cy={y+2} r="2" fill={color}/>
        </g>
      ))}
      {/* bloom on top */}
      <path d="M50 60 Q35 40 50 25 Q65 40 50 60 Z" fill={color} opacity="0.85"/>
      <circle cx="50" cy="40" r="3" fill={accent}/>
    </g>,
    // 1: rosette
    <g key="1">
      <circle cx="50" cy="180" r="3" fill={color}/>
      {[0, 60, 120, 180, 240, 300].map(deg => (
        <g key={deg} transform={`rotate(${deg} 50 180)`}>
          <path d="M50 180 Q42 150 50 120 Q58 150 50 180 Z" fill={color} opacity="0.8"/>
          <path d="M50 175 L50 130" stroke={accent} strokeWidth="0.8"/>
          <circle cx="50" cy="135" r="1.5" fill={accent}/>
        </g>
      ))}
    </g>,
    // 2: bell flower
    <g key="2">
      <path d="M50 240 L50 100" stroke={color} strokeWidth="1.5"/>
      <path d="M50 100 Q30 80 30 60 Q40 50 50 70 Q60 50 70 60 Q70 80 50 100 Z" fill={color}/>
      <path d="M50 100 L50 70" stroke={accent} strokeWidth="0.8"/>
      <circle cx="50" cy="75" r="2" fill={accent}/>
      {/* leaves */}
      <path d="M50 180 Q30 175 25 165" stroke={color} fill="none" strokeWidth="1.2"/>
      <circle cx="25" cy="165" r="2" fill={color}/>
      <path d="M50 200 Q70 195 75 185" stroke={color} fill="none" strokeWidth="1.2"/>
      <circle cx="75" cy="185" r="2" fill={color}/>
    </g>,
    // 3: lily pad
    <g key="3">
      <ellipse cx="50" cy="170" rx="40" ry="12" fill={color} opacity="0.85"/>
      <path d="M50 158 L50 182" stroke={accent} strokeWidth="0.8"/>
      <path d="M14 168 Q50 165 86 168" stroke={accent} strokeWidth="0.6" fill="none"/>
      {/* center flower */}
      <circle cx="50" cy="100" r="14" fill={accent}/>
      {[0, 72, 144, 216, 288].map(deg => (
        <path key={deg} d="M50 100 Q42 84 50 76 Q58 84 50 100 Z" fill={color} opacity="0.9" transform={`rotate(${deg} 50 100)`}/>
      ))}
      <circle cx="50" cy="100" r="3" fill={color}/>
      <path d="M50 114 L50 158" stroke={color} strokeWidth="1.5"/>
    </g>,
    // 4: orchid
    <g key="4">
      <path d="M50 240 L50 140" stroke={color} strokeWidth="1.5"/>
      {/* slipper */}
      <ellipse cx="50" cy="100" rx="22" ry="18" fill={color}/>
      <ellipse cx="50" cy="108" rx="16" ry="10" fill={accent}/>
      {/* wings */}
      <path d="M50 90 Q30 70 22 80 Q35 95 50 95 Z" fill={color} opacity="0.85"/>
      <path d="M50 90 Q70 70 78 80 Q65 95 50 95 Z" fill={color} opacity="0.85"/>
      <path d="M50 85 Q42 65 50 50 Q58 65 50 85 Z" fill={color} opacity="0.9"/>
      {/* leaf */}
      <path d="M50 200 Q25 190 18 175" stroke={color} fill="none" strokeWidth="1.5"/>
      <path d="M50 200 Q75 190 82 175" stroke={color} fill="none" strokeWidth="1.5"/>
    </g>,
    // 5: lichen on bark
    <g key="5">
      {/* bark */}
      <rect x="30" y="40" width="40" height="200" fill={color} opacity="0.25" rx="4"/>
      {/* lichen lobes */}
      <path d="M30 90 Q15 88 12 100 Q14 112 30 110 Z" fill={accent}/>
      <path d="M70 130 Q88 128 90 140 Q86 152 70 150 Z" fill={accent}/>
      <path d="M30 160 Q14 158 12 170 Q15 182 30 180 Z" fill={accent}/>
      <path d="M70 190 Q88 188 92 200 Q88 212 70 210 Z" fill={accent}/>
      <circle cx="30" cy="100" r="6" fill={color} opacity="0.5"/>
      <circle cx="70" cy="140" r="6" fill={color} opacity="0.5"/>
      <circle cx="30" cy="170" r="6" fill={color} opacity="0.5"/>
      <circle cx="70" cy="200" r="6" fill={color} opacity="0.5"/>
    </g>,
    // 6: primrose cluster
    <g key="6">
      <path d="M50 240 L50 150" stroke={color} strokeWidth="1.5"/>
      {[0, 1, 2, 3, 4].map(i => {
        const angle = i * 72;
        return (
          <g key={i} transform={`rotate(${angle} 50 80)`}>
            <circle cx="50" cy="60" r="9" fill={color}/>
            <circle cx="50" cy="60" r="3" fill={accent}/>
          </g>
        );
      })}
      <path d="M50 150 Q25 140 18 120" stroke={color} fill="none" strokeWidth="1.2"/>
      <path d="M50 150 Q75 140 82 120" stroke={color} fill="none" strokeWidth="1.2"/>
    </g>,
    // 7: globeflower
    <g key="7">
      <path d="M50 240 L50 110" stroke={color} strokeWidth="1.5"/>
      <circle cx="50" cy="80" r="28" fill={color}/>
      <circle cx="50" cy="80" r="22" fill={accent} opacity="0.7"/>
      {[0, 1, 2, 3, 4, 5].map(i => {
        const angle = i * 60;
        return <ellipse key={i} cx="50" cy="62" rx="6" ry="14" fill={color} opacity="0.85" transform={`rotate(${angle} 50 80)`}/>;
      })}
      <circle cx="50" cy="80" r="4" fill={color}/>
      <path d="M50 180 Q25 175 20 160" stroke={color} fill="none" strokeWidth="1.2"/>
      <path d="M50 200 Q75 195 80 180" stroke={color} fill="none" strokeWidth="1.2"/>
    </g>
  ];
  return (
    <svg viewBox="0 0 100 280" style={style} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="botbg" cx="50%" cy="40%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.7"/>
          <stop offset="100%" stopColor={accent} stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100" height="280" fill="url(#botbg)"/>
      {variants[variant % variants.length]}
    </svg>
  );
};

// Sparkline / progress / etc.
const Progress = ({ pct, color = "var(--forest)", height = 6 }) => (
  <div style={{ height, background: "rgba(45,84,64,0.10)", borderRadius: 999, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 999, transition: "width 400ms" }} />
  </div>
);

const RarityBadge = ({ rarity, label, compact = false }) => {
  const { t } = (window.useT ? window.useT() : { t: s => s });
  const cls = { CR: "badge-cr", EN: "badge-en", VU: "badge-vu", NT: "badge-nt", LC: "badge-lc", NA: "badge-na" }[rarity] || "badge-na";
  return <span className={`badge ${cls}`}>{compact ? rarity : <>{rarity} · {t(label)}</>}</span>;
};

// Plant image with graceful fallback to the Botanical SVG.
// Real images come from Wikimedia Commons (CC-licensed) per plant in data.jsx;
// if no image URL exists or the image fails to load, the stylised SVG renders.
const PlantImage = ({ plant, style = {}, alt }) => {
  const [errored, setErrored] = React.useState(false);
  if (!plant) return null;
  const hasImage = plant.image && !errored;
  if (hasImage) {
    return (
      <img
        src={plant.image}
        alt={alt || plant.name}
        loading="lazy"
        onError={() => setErrored(true)}
        style={{ objectFit: "cover", display: "block", ...style }}
      />
    );
  }
  return <Botanical color={plant.color} accent={plant.accent} variant={plant.variant} style={style}/>;
};

// Live weather from Open-Meteo (free, no API key). Cached at module scope so
// every screen shares one HTTP call per page load. Returns null while loading
// or on error; otherwise { temp:number, labelKey:string, icon:string }.
let __weatherCache = null;
let __weatherPromise = null;
const __wmoMap = {
  0: ["Clear", "sun"], 1: ["Mostly clear", "sun"], 2: ["Partly cloudy", "sun"], 3: ["Overcast", "sun"],
  45: ["Foggy", "sun"], 48: ["Foggy", "sun"],
  51: ["Light drizzle", "sun"], 53: ["Drizzle", "sun"], 55: ["Drizzle", "sun"],
  61: ["Light rain", "sun"], 63: ["Rain", "sun"], 65: ["Heavy rain", "sun"],
  66: ["Freezing rain", "snow"], 67: ["Freezing rain", "snow"],
  71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
  80: ["Rain showers", "sun"], 81: ["Rain showers", "sun"], 82: ["Heavy showers", "sun"],
  85: ["Snow showers", "snow"], 86: ["Snow showers", "snow"],
  95: ["Thunderstorm", "sun"], 96: ["Thunderstorm", "sun"], 99: ["Thunderstorm", "sun"]
};
const fetchWeather = () => {
  if (__weatherCache && Date.now() - __weatherCache.fetchedAt < 10 * 60 * 1000) {
    return Promise.resolve(__weatherCache);
  }
  if (__weatherPromise) return __weatherPromise;
  // Oulu Botanical Garden: 65.0617°N, 25.4661°E
  const url = "https://api.open-meteo.com/v1/forecast?latitude=65.0617&longitude=25.4661&current=temperature_2m,weather_code&timezone=Europe%2FHelsinki";
  __weatherPromise = fetch(url)
    .then(r => r.json())
    .then(d => {
      const code = d && d.current ? d.current.weather_code : 0;
      const [labelKey, icon] = __wmoMap[code] || ["Clear", "sun"];
      __weatherCache = {
        temp: Math.round((d && d.current ? d.current.temperature_2m : 0)),
        labelKey, icon,
        fetchedAt: Date.now()
      };
      __weatherPromise = null;
      return __weatherCache;
    })
    .catch(() => { __weatherPromise = null; return null; });
  return __weatherPromise;
};
const useWeather = () => {
  const [w, setW] = React.useState(__weatherCache);
  React.useEffect(() => {
    let cancelled = false;
    fetchWeather().then(data => { if (!cancelled && data) setW(data); });
    return () => { cancelled = true; };
  }, []);
  return w;
};

// Persistent saved-plants list (localStorage). Returns [savedIds, toggle, isSaved].
const _getSaved = () => {
  try { return JSON.parse(localStorage.getItem("bloom_saved") || "[]"); }
  catch { return []; }
};
const _setSaved = (arr) => {
  try { localStorage.setItem("bloom_saved", JSON.stringify(arr)); } catch {}
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("bloom_saved_changed"));
};
const useSavedPlants = () => {
  const [saved, setSaved] = React.useState(_getSaved);
  React.useEffect(() => {
    const h = () => setSaved(_getSaved());
    window.addEventListener("bloom_saved_changed", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("bloom_saved_changed", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  const toggle = React.useCallback((id) => {
    const cur = _getSaved();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    _setSaved(next);
    return next.includes(id);
  }, []);
  const isSaved = React.useCallback((id) => saved.includes(id), [saved]);
  return { saved, toggle, isSaved };
};

// Toast: lightweight event bus. Call showToast("...") from anywhere.
const showToast = (message, opts = {}) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("bloom_toast", { detail: { message, ...opts } }));
};

// Share a plant. Uses Web Share API where available, falls back to clipboard.
const sharePlant = async (plant) => {
  const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
  const url = `${base}#plant=${plant.id}`;
  const title = `${plant.name} · BloomOulu`;
  const text = plant.story || `${plant.name} - ${plant.rarityLabel || plant.rarity}`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title, text, url }); return { ok: true, mode: "shared" }; }
    catch (err) { if (err && err.name === "AbortError") return { ok: true, mode: "cancelled" }; }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try { await navigator.clipboard.writeText(url); return { ok: true, mode: "copied" }; }
    catch {}
  }
  return { ok: false, mode: "failed" };
};

// Sticker collection (Kid mode): persistent set of plant IDs scanned.
const useStickerCollection = () => {
  const get = () => {
    try { return JSON.parse(localStorage.getItem("bloom_stickers") || "[]"); }
    catch { return []; }
  };
  const [stickers, setStickers] = React.useState(get);
  React.useEffect(() => {
    const h = () => setStickers(get());
    window.addEventListener("bloom_stickers_changed", h);
    return () => window.removeEventListener("bloom_stickers_changed", h);
  }, []);
  const collect = React.useCallback((id) => {
    const cur = get();
    if (cur.includes(id)) return cur;
    const next = [...cur, id];
    try { localStorage.setItem("bloom_stickers", JSON.stringify(next)); } catch {}
    window.dispatchEvent(new CustomEvent("bloom_stickers_changed"));
    return next;
  }, []);
  return { stickers, collect, has: (id) => stickers.includes(id) };
};

// Responsive helper - true at <=768px viewport
const useIsMobile = (breakpoint = 768) => {
  const get = () => typeof window !== "undefined" && window.innerWidth <= breakpoint;
  const [isMobile, setIsMobile] = React.useState(get);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", handler) : mq.addListener(handler);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", handler) : mq.removeListener(handler);
    };
  }, [breakpoint]);
  return isMobile;
};

// Garden centroid (Oulu Botanical Garden, Linnanmaa)
const GARDEN_CENTER = [65.0617, 25.4661];

// Plant-specific micro-coordinates within the garden (small offsets from centroid).
// In a real deployment these would come from the accession DB; for the demo each
// plant has a deterministic, plausible position so the map markers don't overlap.
const PLANT_COORDS = {
  "puls-pat":  [65.0619, 25.4664], // south esker bed
  "camp-uni":  [65.0623, 25.4658], // alpine fell bed
  "saxi-hirc": [65.0615, 25.4669], // mire / wetland section
  "prim-nut":  [65.0613, 25.4655], // Bothnian Bay bed
  "trol-eur":  [65.0620, 25.4670], // meadow bed 4
  "cyp-cal":   [65.0617, 25.4672], // limestone bed
  "lob-pul":   [65.0625, 25.4663], // aspen stand
  "vict-am":   [65.0617, 25.4661]  // Romeo & Julia greenhouse (centre)
};
const PLANT_BED = {
  "puls-pat":  "South esker bed · 220m through main gate, left at the meadow",
  "camp-uni":  "Alpine / fell bed · north-west of the main path",
  "saxi-hirc": "Wetland (mire) section",
  "prim-nut":  "Bothnian Bay coastal bed",
  "trol-eur":  "Meadow bed 4",
  "cyp-cal":   "Limestone forest bed · bed 7",
  "lob-pul":   "Aspen stand · east edge",
  "vict-am":   "Romeo & Julia greenhouse · main pond"
};

// Interactive Leaflet map of the garden with a marker for the highlighted plant.
const PlantMap = ({ plant, height = 360 }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || typeof L === "undefined") return;
    const coord = (plant && PLANT_COORDS[plant.id]) || GARDEN_CENTER;
    const m = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true })
      .setView(coord, 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);

    // Garden centre + a soft circle marking the garden grounds
    L.circle(GARDEN_CENTER, { radius: 200, color: "#2D5440", weight: 1, fillColor: "#88A050", fillOpacity: 0.18 }).addTo(m);

    if (plant) {
      // Custom marker styled like the BloomOulu pin
      const icon = L.divIcon({
        className: "bloom-pin",
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#B25C3A;border:3px solid #FAF7EE;
          box-shadow:0 4px 10px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;
          color:#FAF7EE;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700">${plant.rarity || "•"}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      const marker = L.marker(coord, { icon, title: plant.name }).addTo(m);
      const bed = PLANT_BED[plant.id] || "Oulu Botanical Garden";
      marker.bindPopup(`<b><i>${plant.name}</i></b><br><span style="font-size:12px;color:#5C6E60">${bed}</span>`).openPopup();
    } else {
      L.marker(GARDEN_CENTER, { title: "Oulu Botanical Garden" })
        .addTo(m)
        .bindPopup("<b>University of Oulu Botanical Garden</b><br>65.0617&deg; N, 25.4661&deg; E")
        .openPopup();
    }

    // Resize once layout settles
    setTimeout(() => m.invalidateSize(), 100);

    return () => { try { m.remove(); } catch {} };
  }, [plant && plant.id]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={plant ? `Map of ${plant.name}` : "Map of Oulu Botanical Garden"}
      style={{ width: "100%", height, borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)" }}
    />
  );
};

// Real scannable QR code via qrcode-generator (loaded in index.html).
// Renders an SVG with a centred BloomOulu mark.
const QRCode = ({ value, size = 180, ecLevel = "H", logoSize = 0.22, color = "#1F3C2D", bg = "#FFFFFF" }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || typeof qrcode === "undefined" || !value) return;
    const qr = qrcode(0, ecLevel);
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / (count + 2); // include 1-cell quiet zone on each side
    const offset = cell;
    let path = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          path += `M${(c * cell + offset).toFixed(2)},${(r * cell + offset).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
        }
      }
    }
    const logo = logoSize > 0 ? Math.round(size * logoSize) : 0;
    ref.current.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code">
        <rect width="${size}" height="${size}" fill="${bg}"/>
        <path d="${path}" fill="${color}"/>
        ${logo ? `
        <rect x="${(size - logo) / 2}" y="${(size - logo) / 2}" width="${logo}" height="${logo}" fill="${bg}" rx="4"/>
        <g transform="translate(${(size - logo) / 2 + logo * 0.1}, ${(size - logo) / 2 + logo * 0.1}) scale(${logo * 0.8 / 100})">
          <defs>
            <linearGradient id="qrlogo" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#2D5440"/>
              <stop offset="50%" stop-color="#5FB0A0"/>
              <stop offset="100%" stop-color="#A8C060"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="42" fill="url(#qrlogo)"/>
        </g>
        ` : ""}
      </svg>
    `;
  }, [value, size, ecLevel, logoSize, color, bg]);
  return <div ref={ref} style={{ lineHeight: 0 }}/>;
};

// Build a deep-link URL for a plant. When scanned, the app reads the hash
// and routes to that plant page on load.
const plantDeepLink = (plantId) => {
  if (typeof window === "undefined") return `#plant=${plantId}`;
  return `${window.location.origin}${window.location.pathname}#plant=${plantId}`;
};

// Funds-flow policy modal: transparent breakdown of where adoption money goes.
// Triggered from Discover's "Read where your money goes", Plant page's
// "Read the policy", and the footer "Funds-flow policy" link. Sources the
// research PDF section 12 (transparency policy) + section 3.3 (VAT split).
const FundsFlowModal = ({ open, onClose, t }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const breakdown = [
    { label: t("Direct ex-situ work"), pct: 62, color: "var(--forest)", note: t("Propagation, seed collection, fieldwork, mycorrhizal partnerships") },
    { label: t("Seed bank deposits (Luomus)"), pct: 18, color: "var(--moss)", note: t("Long-term storage in the Finnish national gene bank under LIFE+ ESCAPE protocols") },
    { label: t("Garden operations & signage"), pct: 12, color: "var(--bloom)", note: t("Curator time, label production, weatherproof QR refresh, accessibility tags") },
    { label: t("Payment & platform costs"), pct: 8, color: "var(--ink-mute)", note: t("MobilePay / Stripe fees, hosting, audit") }
  ];
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={t("Funds-flow policy")}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,10,7,0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--cream)", color: "var(--ink)", borderRadius: 18, padding: 28, maxWidth: 640, width: "100%", boxShadow: "var(--shadow-deep)", position: "relative", margin: "auto" }}>
        <button onClick={onClose} className="icon-btn" aria-label={t("Close")} style={{ position: "absolute", top: 14, right: 14 }}>
          <Icon name="close" size={14}/>
        </button>
        <div className="eyebrow">{t("Transparency")}</div>
        <h2 className="serif" style={{ fontSize: 32, marginTop: 8, lineHeight: 1.1 }}>{t("Where your money goes")}</h2>
        <p className="small muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
          {t("Every adoption is split as follows. Numbers audited annually; the full ledger is published every January.")}
        </p>

        <div style={{ marginTop: 22, padding: "18px 20px", background: "var(--paper)", borderRadius: 14, border: "1px solid var(--line)" }}>
          <div className="tiny" style={{ marginBottom: 14 }}>{t("Of every €100 adopted")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {breakdown.map(b => (
              <div key={b.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 500 }}>{b.label}</span>
                  <span className="serif" style={{ fontSize: 22, color: b.color }}>€{b.pct}</span>
                </div>
                <Progress pct={b.pct} color={b.color} height={4}/>
                <div className="tiny" style={{ marginTop: 4, textTransform: "none", letterSpacing: 0, fontFamily: "var(--f-body)", color: "var(--ink-mute)" }}>{b.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18, padding: 16, background: "rgba(31,58,44,0.04)", borderRadius: 12, fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          <div className="tiny" style={{ marginBottom: 6 }}>{t("How we account for individual plants")}</div>
          {t("Your adoption supports the Garden's conservation programme overall rather than the specific seed you adopted. This mirrors the Royal Botanic Gardens Kew Adopt-a-Seed policy and is recommended by BGCI. If your sponsored plant dies, we offer a replacement in year 1 and a transfer to an equal-or-higher-rarity plant in subsequent years.")}
        </div>

        <div style={{ marginTop: 14, padding: 16, background: "rgba(178,92,58,0.06)", borderRadius: 12, fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          <div className="tiny" style={{ marginBottom: 6, color: "var(--rust)" }}>{t("Tax & VAT")}</div>
          {t("Donations to the University of Oulu (a public foundation) are outside VAT. Tangible adopter benefits (plaques, gift-shop vouchers, greenhouse passes) are treated as a taxable supply at 24% VAT, split at checkout. Finnish corporates may deduct gifts under TVL §57.")}
        </div>

        <div style={{ marginTop: 14, padding: 16, background: "rgba(168,192,96,0.08)", borderRadius: 12, fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          <div className="tiny" style={{ marginBottom: 6, color: "var(--forest)" }}>{t("Audit & reporting")}</div>
          {t("The annual ledger is published every January, aligned with the BGCI Conservation Standards reporting format so the Garden's data feeds international comparisons. Adopters receive a personal year-end PDF receipt with TVL §57 reference text.")}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn btn-secondary small" onClick={onClose}>{t("Close")}</button>
          <a className="btn btn-secondary small" href="https://www.bgci.org/our-work/projects-and-case-studies/" target="_blank" rel="noopener noreferrer">
            <Icon name="info" size={13}/> {t("BGCI Conservation Standards")}
          </a>
        </div>
      </div>
    </div>
  );
};

// Global controller for the funds-flow modal. Any component can call
// `openFundsFlow()` and a single root listener will show the modal.
const openFundsFlow = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("bloom_open_funds_flow"));
};
const FundsFlowController = () => {
  const { t } = (window.useT ? window.useT() : { t: s => s });
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("bloom_open_funds_flow", h);
    return () => window.removeEventListener("bloom_open_funds_flow", h);
  }, []);
  return <FundsFlowModal open={open} onClose={() => setOpen(false)} t={t}/>;
};

Object.assign(window, { Icon, Progress, RarityBadge, Botanical, PlantImage, BloomMark, useIsMobile, useWeather, useSavedPlants, useStickerCollection, showToast, sharePlant, PlantMap, PLANT_BED, PLANT_COORDS, GARDEN_CENTER, QRCode, plantDeepLink, FundsFlowModal, FundsFlowController, openFundsFlow });
