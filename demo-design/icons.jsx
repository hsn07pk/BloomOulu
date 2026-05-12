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

// BloomOulu logo — stylised five-petaled bloom with circuit veining
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

// Botanical illustration — leaf with circuit-style veining, plant-specific
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

Object.assign(window, { Icon, Progress, RarityBadge, Botanical, BloomMark });
