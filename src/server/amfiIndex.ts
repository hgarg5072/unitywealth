import axios from "axios";

export interface AmfiScheme {
  symbol: string;
  shortname: string;
  isins: string[];
  currentPrice: number;
  typeDisp: "MUTUAL_FUND";
  exchDisp: "AMFI";
  isIndia: true;
  // Precomputed read-time fields (non-enumerable or lightweight)
  nameLower: string;
  isDirect: boolean;
  isGrowth: boolean;
  isIdcw: boolean;
}

export interface AmfiIndex {
  schemes: AmfiScheme[];
  byCode: Map<string, AmfiScheme>;
  byIsin: Map<string, AmfiScheme>;
  byNameLower: Map<string, AmfiScheme>;
  tokenPostings: Map<string, number[]>;
  fetchedAt: number;
}

const AMFI_TTL_MS = 12 * 60 * 60 * 1000;
const STOP_WORDS = new Set([
  "fund",
  "scheme",
  "plan",
  "option",
  "direct",
  "regular",
  "growth",
  "idcw",
  "dividend",
  "payout",
  "reinvestment",
  "india",
  "mutual",
  "open",
  "ended",
  "equity",
  "g",
  "d"
]);

let cachedIndex: AmfiIndex | null = null;
let inFlightPromise: Promise<AmfiIndex> | null = null;

function buildIndex(rawText: string): AmfiIndex {
  const lines = rawText.split(/\r?\n/);
  const schemes: AmfiScheme[] = [];
  const byCode = new Map<string, AmfiScheme>();
  const byIsin = new Map<string, AmfiScheme>();
  const byNameLower = new Map<string, AmfiScheme>();
  const tokenPostings = new Map<string, number[]>();

  for (let l = 0; l < lines.length; l++) {
    const trimmed = lines[l].trim();
    if (!trimmed || trimmed.includes("Open Ended Schemes") || trimmed.includes("Close Ended Schemes")) {
      continue;
    }

    const parts = trimmed.includes(";") ? trimmed.split(";") : trimmed.split("|");
    if (parts.length < 4) continue;

    let navIdx = -1;
    for (let i = parts.length - 1; i >= 2; i--) {
      const p = parts[i].trim();
      if (p && !isNaN(parseFloat(p)) && p.includes(".") && !p.includes("-")) {
        navIdx = i;
        break;
      }
    }
    if (navIdx === -1) continue;

    const price = parseFloat(parts[navIdx]);
    if (isNaN(price)) continue;

    const isins = parts
      .slice(1, navIdx)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^INF[A-Z0-9]{9}$/.test(s));

    const nameParts = parts
      .slice(1, navIdx)
      .map((s) => s.trim())
      .filter((s) => s && s !== "-" && !/^INF[A-Z0-9]{9}$/i.test(s) && !/^[A-Z0-9]{12}$/.test(s));

    const fullName = nameParts.join(" - ");
    if (!fullName) continue;

    const symbol = parts[0].trim();
    const nameLower = fullName.toLowerCase();
    const scheme: AmfiScheme = {
      symbol,
      shortname: fullName,
      isins,
      currentPrice: price,
      typeDisp: "MUTUAL_FUND",
      exchDisp: "AMFI",
      isIndia: true,
      nameLower,
      isDirect: nameLower.includes("direct"),
      isGrowth: nameLower.includes("growth"),
      isIdcw: nameLower.includes("idcw") || nameLower.includes("dividend")
    };

    const idx = schemes.length;
    schemes.push(scheme);
    if (symbol) byCode.set(symbol, scheme);
    byNameLower.set(nameLower, scheme);
    for (const isin of isins) {
      byIsin.set(isin, scheme);
    }

    // Build inverted posting list of unique alphanumeric words >= 2 chars
    const words = nameLower.replace(/[^a-z0-9 ]/g, " ").split(/\s+/);
    const seen = new Set<string>();
    for (const w of words) {
      if (w.length < 2 || seen.has(w)) continue;
      seen.add(w);
      let list = tokenPostings.get(w);
      if (!list) {
        list = [];
        tokenPostings.set(w, list);
      }
      list.push(idx);
    }
  }

  return {
    schemes,
    byCode,
    byIsin,
    byNameLower,
    tokenPostings,
    fetchedAt: Date.now()
  };
}

export async function getAmfiIndex(): Promise<AmfiIndex> {
  const now = Date.now();
  if (cachedIndex && cachedIndex.schemes.length > 0 && now - cachedIndex.fetchedAt < AMFI_TTL_MS) {
    return cachedIndex;
  }

  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      console.log("Fetching AMFI data...");
      const response = await axios.get("https://www.amfiindia.com/spages/NAVAll.txt", {
        timeout: 12000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
      });
      const built = buildIndex(String(response.data || ""));
      console.log(`AMFI Parse complete. Indexed ${built.schemes.length} schemes (${built.byIsin.size} ISINs).`);
      cachedIndex = built;
      return built;
    } catch (e) {
      console.error("AMFI Fetch failed:", e);
      return (
        cachedIndex || {
          schemes: [],
          byCode: new Map(),
          byIsin: new Map(),
          byNameLower: new Map(),
          tokenPostings: new Map(),
          fetchedAt: 0
        }
      );
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

function toPublicScheme(s: AmfiScheme) {
  return {
    symbol: s.symbol,
    shortname: s.shortname,
    isins: s.isins,
    currentPrice: s.currentPrice,
    typeDisp: s.typeDisp,
    exchDisp: s.exchDisp,
    isIndia: s.isIndia
  };
}

export function searchAmfiIndex(idx: AmfiIndex, rawQuery: string, limit = 15) {
  const query = rawQuery.toLowerCase().trim();
  if (!query) return [];

  // Fast O(1) exact scheme code / ISIN hit
  const exactCode = idx.byCode.get(query) || idx.byIsin.get(query.toUpperCase());
  if (exactCode) return [toPublicScheme(exactCode)];

  const tokens = query.split(/\s+/).filter(Boolean);
  // Seed from rarest exact word posting list if available; otherwise scan pre-lowercased strings
  let seedIndices: number[] | null = null;
  for (const tok of tokens) {
    const cleanTok = tok.replace(/[^a-z0-9]/g, "");
    const posting = idx.tokenPostings.get(cleanTok);
    if (posting && (!seedIndices || posting.length < seedIndices.length)) {
      seedIndices = posting;
    }
  }

  const matched: AmfiScheme[] = [];
  if (seedIndices && seedIndices.length > 0) {
    for (let i = 0; i < seedIndices.length; i++) {
      const s = idx.schemes[seedIndices[i]];
      if (tokens.every((tok) => s.nameLower.includes(tok))) {
        matched.push(s);
      }
    }
  }

  // Fallback to pre-lowercased scan if prefix/partial token wasn't an exact whole word
  if (matched.length === 0) {
    for (let i = 0; i < idx.schemes.length; i++) {
      const s = idx.schemes[i];
      if (s.symbol.includes(query) || tokens.every((tok) => s.nameLower.includes(tok))) {
        matched.push(s);
      }
    }
  }

  matched.sort((a, b) => {
    const aDG = a.isDirect && a.isGrowth ? 0 : 1;
    const bDG = b.isDirect && b.isGrowth ? 0 : 1;
    return aDG - bDG;
  });

  return matched.slice(0, limit).map(toPublicScheme);
}

export function findAmfiMatchIndexed(idx: AmfiIndex, holding: any): AmfiScheme | null {
  if (!idx || idx.schemes.length === 0) return null;
  const ticker = String(holding.ticker || "").trim();
  const orig = String(holding.originalName || "").trim();
  const explicitIsin = String(holding.isin || "").trim().toUpperCase();

  // 1. O(1) ISIN lookup
  const embeddedIsinMatch = `${explicitIsin} ${orig} ${ticker}`.match(/\b(INF[A-Z0-9]{9})\b/i);
  if (embeddedIsinMatch) {
    const byIsin = idx.byIsin.get(embeddedIsinMatch[1].toUpperCase());
    if (byIsin) return byIsin;
  }

  // 2. O(1) Scheme Code or Exact Name lookup
  if (ticker) {
    const byCode = idx.byCode.get(ticker) || idx.byNameLower.get(ticker.toLowerCase());
    if (byCode) return byCode;
  }
  if (orig) {
    const byOrig = idx.byNameLower.get(orig.toLowerCase());
    if (byOrig) return byOrig;
  }

  // 3. Inverted token index lookup
  const rawName = orig || ticker;
  const cleanedTarget = rawName
    .replace(/,?\s*ISIN\s*:.*$/i, "")
    .replace(/\(formerly[^)]*\)/gi, "")
    .replace(/\(erstwhile[^)]*\)/gi, "")
    .replace(/^[A-Z0-9]{3,10}\s*[-–—]\s*/i, "")
    .toLowerCase();

  const wantsDirect = /\bdirect\b/.test(cleanedTarget);
  const wantsIdcw = /\b(idcw|dividend|payout|reinvestment)\b/.test(cleanedTarget);
  const coreTokens = cleanedTarget
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  if (coreTokens.length < 2) return null;

  // Intersect starting from shortest posting list
  let rarestPosting: number[] | null = null;
  for (const tok of coreTokens) {
    const list = idx.tokenPostings.get(tok);
    if (list && (!rarestPosting || list.length < rarestPosting.length)) {
      rarestPosting = list;
    }
  }

  const candidates: AmfiScheme[] = [];
  if (rarestPosting) {
    for (let i = 0; i < rarestPosting.length; i++) {
      const s = idx.schemes[rarestPosting[i]];
      if (coreTokens.every((tok) => s.nameLower.includes(tok))) {
        candidates.push(s);
      }
    }
  } else {
    for (let i = 0; i < idx.schemes.length; i++) {
      const s = idx.schemes[i];
      if (coreTokens.every((tok) => s.nameLower.includes(tok))) {
        candidates.push(s);
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aPlanScore = (wantsDirect ? a.isDirect : !a.isDirect) ? 0 : 1;
    const bPlanScore = (wantsDirect ? b.isDirect : !b.isDirect) ? 0 : 1;
    if (aPlanScore !== bPlanScore) return aPlanScore - bPlanScore;
    const aOptScore = (wantsIdcw ? a.isIdcw : a.isGrowth) ? 0 : 1;
    const bOptScore = (wantsIdcw ? b.isIdcw : b.isGrowth) ? 0 : 1;
    if (aOptScore !== bOptScore) return aOptScore - bOptScore;
    return a.nameLower.length - b.nameLower.length;
  });

  return candidates[0];
}
