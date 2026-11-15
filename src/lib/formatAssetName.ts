const UPPER_ACRONYMS = new Set([
  '3M', 'AI', 'AMD', 'AMC', 'AMEX', 'API', 'ARK', 'ASML', 'AT&T', 'AWS', 'AXP',
  'B2B', 'BBC', 'BHEL', 'BMW', 'BNP', 'BOE', 'BOI', 'BP', 'BSE', 'BYD',
  'CBOE', 'CD', 'CDS', 'CDSL', 'CPSE', 'CRM', 'CRSP', 'CSCO', 'CVS',
  'DBS', 'DFA', 'DLF', 'DRAM', 'DSP',
  'EAFE', 'ELSS', 'EM', 'EMC', 'EPF', 'EPFO', 'ESG', 'ETF', 'ETFS', 'ETN', 'ETP', 'EU', 'EV',
  'FD', 'FMCG', 'FOF', 'FTSE', 'FX',
  'GBP', 'GDP', 'GE', 'GM', 'GS', 'GSK',
  'HCL', 'HDFC', 'HP', 'HSBC',
  'IBM', 'ICICI', 'IDBI', 'IDCW', 'IDFC', 'IFCI', 'IIFL', 'IND', 'INR', 'IOB', 'IOC', 'IPO', 'IRA', 'IRB', 'IRCTC', 'IRFC', 'ITC', 'ITOT', 'IVV',
  'JIO', 'JM', 'JNJ', 'JPM',
  'KLA', 'KPMG', 'KPIT',
  'L&T', 'LG', 'LIC', 'LLP', 'LT', 'LTIM', 'LTTS',
  'M&M', 'MBS', 'MCX', 'MF', 'MIT', 'MMTC', 'MOAT', 'MRF', 'MSCI', 'MSE', 'MSTR',
  'NASDAQ', 'NAV', 'NBCC', 'NCC', 'NHPC', 'NIIT', 'NJ', 'NMC', 'NMDC', 'NPS', 'NRE', 'NRO', 'NSE', 'NTPC', 'NVIDIA', 'NXP', 'NYSE',
  'ONGC', 'ORCL',
  'PF', 'PFC', 'PG', 'PGIM', 'PNB', 'PPF', 'PPFAS', 'PSU', 'PTC', 'PVR',
  'QCOM', 'QQQ', 'QQQM', 'QTOP',
  'R&D', 'RBI', 'RBL', 'RD', 'REC', 'REIT', 'REITS', 'RSU',
  'S&P', 'SAIL', 'SAP', 'SBI', 'SCHD', 'SEBI', 'SGX', 'SGB', 'SHV', 'SIM', 'SIP', 'SJVN', 'SK', 'SMCI', 'SMH', 'SOXX', 'SPDR', 'SPY', 'SRF',
  'TCS', 'TECHM', 'TIPS', 'TJX', 'TMO', 'TSM', 'TSMC', 'TVS',
  'UBS', 'UCO', 'UK', 'UNH', 'UPS', 'US', 'USA', 'USD', 'UST', 'UTI',
  'VGT', 'VIG', 'VNQ', 'VOO', 'VTI', 'VT', 'VXUS',
  'WDC',
  'XLE', 'XLF', 'XLK', 'XLV', 'XOM',
  'YTD'
]);

const BRAND_CASING: Record<string, string> = {
  ishares: 'iShares',
  invesco: 'Invesco',
  vaneck: 'VanEck',
  wisdomtree: 'WisdomTree',
  proshares: 'ProShares',
  firsttrust: 'FirstTrust',
  jpmorgan: 'JPMorgan',
  mercadolibre: 'MercadoLibre',
  mastercard: 'Mastercard',
  salesforce: 'Salesforce',
  servicenow: 'ServiceNow',
  crowdstrike: 'CrowdStrike',
  cloudflare: 'Cloudflare',
  palantir: 'Palantir',
  supermicro: 'Supermicro',
  astrazeneca: 'AstraZeneca',
  glaxosmithkline: 'GSK',
  unitedhealth: 'UnitedHealth',
  berkshire: 'Berkshire',
  blackrock: 'BlackRock',
  whiteoak: 'WhiteOak',
  trustmf: 'TrustMF',
  indiabulls: 'Indiabulls',
  one97: 'One97',
  paytm: 'Paytm',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  qualcomm: 'Qualcomm',
  broadcom: 'Broadcom',
  nvidia: 'NVIDIA',
  asml: 'ASML',
  tsmc: 'TSMC',
  abcl: 'ABCL',
  absl: 'ABSL',
  ppfas: 'PPFAS',
  bees: 'BeES',
  fof: 'FoF',
  nifty: 'Nifty',
  sensex: 'Sensex'
};

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with'
]);

/**
 * Known Indian AMC & US/Global ETF issuer first-words.
 * Used by the unified code-prefix stripper to recognize `<RTA_OR_BROKER_CODE>-<Issuer ...>`
 * (e.g. `HNNIDG-HDFC Nifty Next50`, `PLFNNGDG-Navi Nifty Next 50`, `VOO-Vanguard S&P 500 ETF`).
 */
const KNOWN_ISSUER_HEADS = new Set([
  // Indian AMCs
  'absl', 'aditya', 'axis', 'bajaj', 'bandhan', 'bank', 'baroda', 'birla', 'bnp', 'boi',
  'canara', 'dsp', 'edelweiss', 'essel', 'franklin', 'groww', 'hdfc', 'helios', 'hsbc',
  'icici', 'idbi', 'idfc', 'iifl', 'indiabulls', 'invesco', 'iti', 'jm', 'jio', 'kotak',
  'l&t', 'lic', 'mahindra', 'mirae', 'motilal', 'navi', 'nippon', 'nj', 'old', 'parag',
  'peerless', 'pgim', 'ppfas', 'principal', 'quant', 'quantum', 'samco', 'sbi', 'shriram',
  'sundaram', 'tata', 'taurus', 'templeton', 'trust', 'trustmf', 'union', 'uti', 'whiteoak', 'zerodha',
  // US & Global ETF / Fund Issuers
  'american', 'ark', 'avantis', 'blackrock', 'charles', 'dimensional', 'DFA', 'fidelity',
  'first', 'franklin', 'global', 'goldman', 'ishares', 'jpmorgan', 'pacer', 'pimco',
  'proshares', 'schwab', 'select', 'spdr', 'state', 'vaneck', 'vanguard', 'wisdomtree'
]);

/**
 * Real brand/company prefixes that legitimately appear before a hyphen (e.g. `SBI-ETF Nifty 50`,
 * `Coca-Cola`, `Mercedes-Benz`, `Rolls-Royce`, `Bristol-Myers`, `Mid-Cap`) and must NOT be treated
 * as disposable RTA codes unless the brand itself repeats right after the hyphen.
 */
const PROTECTED_HYPHEN_PREFIXES = new Set([
  '3m', '360', 'absl', 'all', 'ark', 'asia', 'bajaj', 'bhel', 'bi', 'blue', 'bnp', 'boi',
  'bristol', 'coca', 'co', 'cross', 'dlf', 'dsp', 'euro', 'ex', 'fixed', 'franco', 'freeport',
  'ge', 'gm', 'gs', 'harley', 'hcl', 'hdfc', 'hewlett', 'high', 'hp', 'hsbc', 'icici', 'idfc',
  'ind', 'inter', 'ishares', 'itc', 'jio', 'jm', 'jpm', 'kimberly', 'kotak', 'l&t', 'large',
  'lic', 'lockheed', 'long', 'low', 'm&m', 'maruti', 'mega', 'mercedes', 'micro', 'mid',
  'multi', 'neo', 'nippon', 'nj', 'non', 'ntpc', 'ongc', 'open', 'pan', 'parker', 'pgim',
  'post', 'ppfas', 'pre', 'pro', 'real', 'rolls', 's&p', 'sbi', 'semi', 'sherwin', 'short',
  'small', 'spdr', 'sub', 't', 'tata', 'tax', 'tcs', 'tokio', 'trans', 'tri', 'tvs', 'ubs',
  'ultra', 'us', 'uti'
]);

function capitalizeWord(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Unified detector for leading RTA / Folio / Broker / Ticker scheme codes before `-` or `:`,
 * covering both Indian MFs (`HNNIDG-HDFC...`, `PLFNNGDG-Navi...`, `128TSDGG-Tata...`, `PP001ZG - ...`)
 * and US/Global ETFs & stocks (`VOO - Vanguard...`, `QQQM: Invesco...`).
 */
function stripLeadingSchemeOrTickerCode(input: string, upperTicker: string): string {
  // 1. Exact ticker prefix: e.g. "VOO - Vanguard S&P 500 ETF" or "QQQM: Invesco NASDAQ 100 ETF"
  if (upperTicker && upperTicker.length >= 2) {
    const escaped = upperTicker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactTickerRe = new RegExp(`^${escaped}\\s*[\\-–—:]\\s*(?=[A-Za-z0-9])`, 'i');
    if (exactTickerRe.test(input)) {
      const rest = input.replace(exactTickerRe, '').trim();
      const firstRest = (rest.split(/[\s\-–—]+/)[0] || '').toLowerCase();
      // Keep "SBI-ETF Nifty 50" if ticker happens to be "SBI", otherwise strip duplicate ticker prefix
      if (rest.split(/\s+/).length >= 2 && firstRest !== 'etf') {
        return rest;
      }
    }
  }

  // 2. General `<CODE> - <Rest>` or `<CODE>-<Rest>` check
  const m = input.match(/^([A-Za-z0-9]{2,15})\s*[\-–—]\s*(.+)$/);
  if (!m) return input;

  const [, rawPrefix, rawRest] = m;
  const prefixLower = rawPrefix.toLowerCase();
  const restTrimmed = rawRest.trim();
  if (!restTrimmed) return input;

  const restWords = restTrimmed.split(/\s+/);
  const firstRestWordClean = (restWords[0] || '').replace(/[^A-Za-z0-9&]/g, '').toLowerCase();

  // If the same brand repeats across the hyphen (e.g. "SBI - SBI Magnum Gilt"), always collapse
  if (prefixLower === firstRestWordClean) {
    return restTrimmed;
  }

  // Never strip protected real brand/word prefixes (e.g. "Coca-Cola", "Mercedes-Benz", "SBI-ETF Nifty 50")
  if (PROTECTED_HYPHEN_PREFIXES.has(prefixLower)) {
    return input;
  }

  // Case A: Alphanumeric code containing at least one digit (e.g. "PP001ZG", "128TSDGG", "119551", "INF179K01BE2")
  if (/\d/.test(rawPrefix)) {
    return restTrimmed;
  }

  // Case B: Pure-letter RTA / Broker code (3–15 letters, e.g. "HNNIDG", "Hnnidg", "PLFNNGDG", "PBPFGP", "RMFLFG")
  if (rawPrefix.length >= 3) {
    // Signal 1: Word immediately after `-` is a known Indian AMC or US/Global ETF issuer
    if (KNOWN_ISSUER_HEADS.has(firstRestWordClean)) {
      return restTrimmed;
    }

    // Signal 2: Unpronounceable RTA code pattern (3+ consecutive consonants, no vowels, ALL-CAPS before MixedCase, or *DG/*RG/*GP suffix)
    const has3Consonants = /[bcdfghjklmnpqrstvwxyz]{3,}/i.test(rawPrefix);
    const hasNoVowels = !/[aeiouy]/i.test(rawPrefix);
    const isAllCapsBeforeMixedCase =
      rawPrefix.length >= 4 &&
      rawPrefix === rawPrefix.toUpperCase() &&
      /^[A-Z][a-z]/.test(restWords[0] || '');
    const hasRtaPlanSuffix = rawPrefix.length >= 5 && /(?:DG|RG|DP|RP|GP|GG|QD|MD)$/i.test(rawPrefix);

    if (
      restWords.length >= 2 &&
      (has3Consonants || hasNoVowels || isAllCapsBeforeMixedCase || hasRtaPlanSuffix)
    ) {
      return restTrimmed;
    }
  }

  return input;
}

/**
 * Unified shortening pipeline for Indian Mutual Funds, US / Global ETFs, and Stocks.
 *
 * Every instrument follows the same 6-stage normalization:
 *   1. Extract share class (`(Cl A/B/C)`) & strip identifier tails (`ISIN`, `CUSIP`, `(formerly ...)`)
 *   2. Strip leading RTA / folio / ticker code prefixes (`HNNIDG-`, `PLFNNGDG-`, `PP001ZG - `, `VOO - `)
 *   3. Collapse umbrella trust & verbose issuer prefixes (`iShares Trust iShares ...`, `ICICI Prudential ...`)
 *   4. Strip plan / option / brokerage / corporate boilerplate (`Direct Plan - Growth`, `Common Stock`, `Inc`)
 *   5. Normalize glued index numbers & shorthand (`Next50` → `Next 50`, `BRD MKT` → `Broad Market`)
 *   6. Apply smart acronym/brand casing & clean word-boundary length cap.
 */
export function shortenAssetName(name: string, ticker?: string): string {
  if (!name) return '';
  let clean = name.trim();
  const upperTicker = (ticker || '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|L|DE|AS|PA|TO|HK)$/, '');

  // 0. Detect if original input is predominantly ALL-CAPS (typical of CAMS / US brokerage statements)
  const letters = clean.match(/[A-Za-z]/g) || [];
  const upperCount = letters.filter((ch) => ch === ch.toUpperCase() && ch !== ch.toLowerCase()).length;
  const wasMostlyUpper = letters.length >= 4 && upperCount / letters.length >= 0.78;

  // 1. Extract Share Class (Cl A / B / C) BEFORE stripping CAP STK / COMMON STOCK
  let classLabel = '';
  if (!/\bPlan\s+[ABC]\b/i.test(clean)) {
    const clsMatch = clean.match(/(?:\bCL(?:ASS)?[\s.\-]+([ABC])\b|\(\s*CLASS\s+([ABC])\s*\))/i);
    if (clsMatch) {
      const clsChar = (clsMatch[1] || clsMatch[2] || '').toUpperCase();
      if (clsChar) classLabel = `(Cl ${clsChar})`;
    }
  }

  // 2. Strip ISIN, CUSIP, and parenthetical rename/category suffixes
  clean = clean
    .replace(/,?\s*ISIN\s*:\s*[A-Z0-9]+.*$/i, '')
    .replace(/,?\s*CUSIP\s*:?\s*#?[A-Z0-9]+.*$/i, '')
    .replace(/\s*\((formerly|erstwhile|non-demat|equity|debt|hybrid)[^)]*\).*$/i, '')
    .replace(/\s*\([GD]\)\s*$/i, '');

  // 3. Unified leading RTA / folio / scheme / ticker code stripper (run up to 2 passes for nested "120503 - HNNIDG-HDFC...")
  for (let pass = 0; pass < 2; pass++) {
    const stripped = stripLeadingSchemeOrTickerCode(clean, upperTicker);
    if (stripped !== clean) {
      clean = stripped;
    } else {
      break;
    }
  }

  // Strip corporate-entity + EQUITY bleed first (e.g. "ARM HLDGS PLC EQUITY A FUNSPONSORED ADR..." -> "ARM HLDGS PLC")
  clean = clean.replace(
    /\b(PLC|INC(?:ORPORATED)?|CORP(?:ORATION)?|LTD|LIMITED|N\.?V\.?|S\.?A\.?|A\.?G\.?|S\.?E\.?)\s+EQUITY\b.*$/i,
    '$1'
  );

  // 4. Unified Plan / Option / Brokerage / Registry Tail Stripper (Indian MF + US ETF/Stock)
  const tailCutMarkers = [
    // Indian MF plan & dividend/growth option tails
    /\s*[\-–—]\s*Direct\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Regular\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Institutional\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Retail\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Plan\s*[A-Z0-9]+\b.*$/i,
    /\s*[\-–—]\s*(Growth|IDCW|Dividend|Payout|Reinvestment|Bonus)\b.*$/i,
    /\b(Direct|Regular)\s+Plan\b.*$/i,
    /\b(Direct|Regular)\s+Growth\b.*$/i,
    /\b(Growth|IDCW)\s+(?:Option|Plan)\b.*$/i,
    // US / Global ADR, Share, Trust-Unit & Brokerage statement tails
    /\s*[\-–—]\s*New\s+York\s+Registry\s+Sh(?:are)?s?.*$/i,
    /\bNew\s+York\s+Registry\s+Sh(?:are)?s?.*$/i,
    /\bNY\s+Reg(?:istry)?\s+Sh(?:r?s|ares)?\b.*$/i,
    /\bEQUITY\b.*?\b(?:F?UN)?SPONSORED\b.*$/i,
    /\b(?:F?UN)?SPONSORED\s+(?:ADR|ADS|AMER|GLOBAL|GDR)\b.*$/i,
    /\b(?:UN)?SPON(?:S|SORED)?\s+(?:ADR|ADS|GDR)\b.*$/i,
    /\bAMERICAN\s+DEPOSITARY\b.*$/i,
    /\bAMER(?:ICAN)?\s+DEP(?:OSITARY)?\s+(?:SH(?:ARE)?S?|RCPT|RECEIPTS?)\b.*$/i,
    /\bGLOBAL\s+DEPOSITARY\b.*$/i,
    /\b\d+\s*(?:ADR|ADS|GDR)\s+REP(?:RESENTING|S)?\b.*$/i,
    /\bEACH\s+(?:ADR|ADS|GDR)\s+REP(?:RESENTING|S)?\b.*$/i,
    /\b(?:ADR|ADS|GDR)\s+REP(?:RESENTING|S)?\b.*$/i,
    /\bCAP(?:ITAL)?\s+ST(?:OC)?K\b.*$/i,
    /\bCOMMON\s+ST(?:OC)?K\b.*$/i,
    /\bCOM(?:MON)?\s+(?:STK|SHS|SHARES|USD\s*[0-9.]*|NPV|PAR\b).*$/i,
    /\bORD(?:INARY)?\s+(?:SH(?:ARE)?S?|STK|USD\s*[0-9.]*|GBP\s*[0-9.]*|EUR\s*[0-9.]*|NPV|PAR\b).*$/i,
    /\bETF\s+SH(?:ARE)?S\b.*$/i,
    /\bSH(?:ARE)?S?\s+NEW\b.*$/i,
    /\bTR(?:UST)?\s+UNIT(?:\s+SER(?:IES)?\s*[A-Z0-9]+)?\b.*$/i,
    /\bUNIT\s+SER(?:IES)?\s*[A-Z0-9]+\b.*$/i,
    /\bPAR\s+\$?[0-9.]+\b.*$/i,
    /\bVESTED\s+RSU\b.*$/i,
    /\bRESTRICTED\s+ST(?:OC)?K\b.*$/i
  ];
  for (const pat of tailCutMarkers) {
    clean = clean.replace(pat, '');
  }

  if (classLabel) {
    clean = clean
      .replace(/\bCL(?:ASS)?[\s.\-]+[ABC]\b(?:\s+NEW)?/gi, '')
      .replace(/\(\s*CLASS\s+[ABC]\s*\)/gi, '');
  }

  // 5. Unified Umbrella Trust & Fund Wrapper Collapse (handles both US ETFs and Indian MFs identically)
  clean = clean
    // Repeated brand after umbrella trust/fund (e.g. "iShares Trust iShares Core...", "Vanguard World Fund Vanguard Mega...", "Invesco Exchange-Traded Fund Trust II Invesco...")
    .replace(
      /^([A-Za-z0-9&]+(?:\s+Trust)?)\s+(?:[A-Za-z\-]+\s+){0,4}?(?:F(?:un)?ds?\s+Tr(?:ust)?|ETF\s+Tr(?:ust)?|Strategic\s+Tr(?:ust)?|Series\s+Tr(?:ust)?|Ser\s+Tr|Index\s+Shares\s+F(?:un)?ds?|Exchange[\s\-]+Traded\s+F(?:un)?d(?:\s+Tr(?:ust)?)?|Index\s+F(?:un)?ds?|World\s+F(?:un)?ds?|Tr(?:ust)?|F(?:un)?ds?|Inc)(?:\s+[IVX]+)?\s+\1\b/i,
      '$1'
    )
    // Non-repeating umbrella wrappers (e.g. "American Century ETF Trust Avantis...", "iShares Tr Core...", "Vanguard Intl Equity Index Fds FTSE...", "Schwab Strategic Tr US...", "SPDR Ser Tr Portfolio...")
    .replace(/^American\s+Century\s+ETF\s+Tr(?:ust)?\s+(?=Avantis\b)/i, '')
    .replace(/^Select\s+Sector\s+SPDR\s+Tr(?:ust)?\s+(?:The\s+)?/i, 'SPDR ')
    .replace(
      /^(Vanguard|iShares|Schwab|SPDR|Invesco|VanEck|WisdomTree|Fidelity|BlackRock|Dimensional|First\s+Trust|ProShares|Global\s+X|Pacer)\s+(?:(?:Intl|International|Equity|Bond|Fixed\s+Income|Index|World|Strategic|Series|Ser|Scottsdale|Malvern|Whitehall|Valley\s+Forge|Tax[\s\-]Managed|Exchange[\s\-]Traded)\s+)*(?:F(?:un)?ds?\s+Tr(?:ust)?|ETF\s+Tr(?:ust)?|Index\s+F(?:un)?ds?|F(?:un)?ds?|Tr(?:ust)?|Inc)(?:\s+[IVX]+)?\s+/i,
      '$1 '
    )
    .replace(/\bExchange[\s\-]+Traded\s+F(?:un)?ds?\b/gi, 'ETF')
    .replace(/\b(?:INDEX\s+F(?:UN)?DS?|FUNDS?\s+TR(?:UST)?)\b/gi, '')
    .replace(/\bETF\s+TR(?:UST)?\b(?=.*\bETF\b)/gi, '')
    .replace(/\bETF\s+TR(?:UST)?\b/gi, 'ETF');

  // 6. Peel trailing corporate / registry / jurisdiction suffixes
  const trailingCorp =
    /(?:[,\s]+|\s+)(?:(?:\&\s+|AND\s+)?CO|INC(?:ORPORATED)?|CORP(?:ORATION)?|PLC|P\s+L\s+C|LTD|LIMITED|LLC|LP|LLP|N\.?V\.?|N\s+V|S\.?A\.?(?:\s*B\.?)?|S\s+A|A\.?G\.?|A\s+G|S\.?E\.?|S\s+E|A\/S|A\s+S|K\.?K\.?|B\.?V\.?|B\s+V|OYJ|AB|COM|DEL|NEW|SHS|SHARES|STK|ADR|ADS|GDR|ORD|NPV)\.?\s*$/i;

  for (let i = 0; i < 5; i++) {
    const next = clean.replace(trailingCorp, '').replace(/[\s,.\-–—/&]+$/, '').trim();
    if (next && next !== clean) {
      clean = next;
    } else {
      break;
    }
  }

  // 7. Unified Issuer Abbreviations, Index Spacing & Brokerage Shorthand (Indian MFs + US ETFs)
  const replacements: [RegExp, string][] = [
    // Indian AMC abbreviations
    [/^Aditya Birla Sun Life\b/i, 'ABSL'],
    [/^Birla Sun Life\b/i, 'ABSL'],
    [/^ICICI Prudential\b/i, 'ICICI Pru'],
    [/^Parag Parikh\b/i, 'PPFAS'],
    [/^Franklin India\b/i, 'Franklin'],
    [/^Templeton India\b/i, 'Templeton'],
    [/^Nippon India\b/i, 'Nippon'],
    [/^Motilal Oswal\b/i, 'Motilal'],
    [/^Kotak Mahindra\b/i, 'Kotak'],
    [/^Mirae Asset\b/i, 'Mirae'],
    [/^Mahindra Manulife\b/i, 'Mahindra'],
    [/^Canara Robeco\b/i, 'Canara'],
    [/^DSP BlackRock\b/i, 'DSP'],
    [/^WhiteOak Capital\b/i, 'WhiteOak'],
    [/^Invesco India\b/i, 'Invesco'],
    [/^Edelweiss\b/i, 'Edelweiss'],
    [/^Bandhan\b/i, 'Bandhan'],
    // US / Global issuer & index normalizations
    [/^Dimensional\s+Fund\s+Advisors\b/i, 'Dimensional'],
    [/\bU\.S\.A\.(?=\s|$)/gi, 'USA'],
    [/\bU\.S\.(?=\s|$)/gi, 'US'],
    [/\bS&P\s*(\d{3,4})\b/gi, 'S&P $1'],
    [/\b(Nifty|Next|Sensex|Midcap|Smallcap|Largecap|Top|Alpha)(\d{2,3})\b/gi, '$1 $2'],
    [/\bBRD\s+MKT\b/gi, 'Broad Market'],
    [/\bBROAD\s+MKT\b/gi, 'Broad Market'],
    [/\bTOT\s+MKT\b/gi, 'Total Market'],
    [/\bEMERG(?:ING)?\s+MKTS?\b/gi, 'Emerging Markets'],
    [/\bDEV(?:ELOPED)?\s+MKTS?\b/gi, 'Developed Markets'],
    [/\bMKTS\b/gi, 'Markets'],
    [/\bMKT\b/gi, 'Market'],
    [/\bDeveloped World Overseas Equity Passive\b/gi, 'Developed World'],
    [/\bSEMICONDUCTOR\s+MFG\b/gi, 'Semiconductor'],
    [/\bHLDGS\b/gi, 'Holdings'],
    [/\bHLDG\b/gi, 'Holding'],
    [/\bINTL\b/gi, 'Intl'],
    [/\bInternational\b/gi, 'Intl'],
    [/\bOpportunities\b/gi, 'Opp'],
    [/\bInfrastructure\b/gi, 'Infra'],
    [/\bTechnologies\b/gi, 'Tech'],
    [/\bTechnology\b/gi, 'Tech'],
    [/\bHealthcare\b/gi, 'Health'],
    [/\bPharmaceuticals?\b/gi, 'Pharma'],
    [/\bManufacturing\b/gi, 'Mfg'],
    [/\bMFG\b/gi, 'Mfg'],
    [/\bFINL\b/gi, 'Financial'],
    [/\bSYS\b/gi, 'Systems'],
    [/\bGRP\b/gi, 'Group'],
    [/\s+and\s+/gi, ' & ']
  ];
  replacements.forEach(([pattern, short]) => {
    clean = clean.replace(pattern, short);
  });

  // 8. Strip trailing "Mutual Fund" / "Fund" / "FD" / "Scheme" / "Trust" if >=2 words remain
  if (!/\b(Provident|Emergency|Savings|Pension|Chit|Sinking|Endowment)\s+Fund\s*$/i.test(clean)) {
    const strippedTrailing = clean
      .replace(/\s+(Mutual\s+Fund|Fund|FD|Scheme|Plan|Option|Trust)\s*$/i, '')
      .trim();
    if (strippedTrailing.split(/\s+/).length >= 2) {
      clean = strippedTrailing;
    }
  }

  clean = clean.replace(/\s*[\-–—,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  // 9. Smart casing for ALL-CAPS statement strings while preserving acronyms & brand names
  const words = clean.split(' ').filter(Boolean);
  const formattedWords = words.map((w, idx) => {
    const tokMatch = w.match(/^([^A-Za-z0-9&/]*)([A-Za-z0-9&/.\-]+)([^A-Za-z0-9&/]*)$/);
    if (!tokMatch) return w;
    const [, prefix, core, suffix] = tokMatch;
    const low = core.toLowerCase();
    const up = core.toUpperCase();

    if (BRAND_CASING[low]) {
      return `${prefix}${BRAND_CASING[low]}${suffix}`;
    }
    if (UPPER_ACRONYMS.has(up)) {
      return `${prefix}${up}${suffix}`;
    }
    if (upperTicker && up === upperTicker && up.length <= 5 && words.length === 1) {
      return `${prefix}${up}${suffix}`;
    }
    const isAllCapsWord = core === up && core !== low && core.length >= 4;
    if (wasMostlyUpper || isAllCapsWord) {
      if (idx > 0 && SMALL_WORDS.has(low)) {
        return `${prefix}${low}${suffix}`;
      }
      if (core.includes('-')) {
        const parts = core.split('-').map((p) => {
          const pLow = p.toLowerCase();
          const pUp = p.toUpperCase();
          if (BRAND_CASING[pLow]) return BRAND_CASING[pLow];
          if (UPPER_ACRONYMS.has(pUp)) return pUp;
          return capitalizeWord(p);
        });
        return `${prefix}${parts.join('-')}${suffix}`;
      }
      return `${prefix}${capitalizeWord(core)}${suffix}`;
    }
    return w;
  });

  clean = formattedWords.join(' ').trim();

  // 10. Re-attach Share Class if present in raw description
  if (classLabel && !clean.toLowerCase().includes(classLabel.toLowerCase())) {
    clean = `${clean} ${classLabel}`.trim();
  }

  // 11. Final word-boundary length cap for unusually long structured note / ETF names
  if (clean.length > 38) {
    const hasEtf = clean.endsWith(' ETF');
    const outWords = clean.split(' ');
    const acc: string[] = [];
    const limit = hasEtf ? 33 : 36;
    for (const w of outWords) {
      if (hasEtf && w === 'ETF') continue;
      const candidate = acc.length > 0 ? `${acc.join(' ')} ${w}` : w;
      if (candidate.length <= limit) {
        acc.push(w);
      } else {
        break;
      }
    }
    if (acc.length >= 2) {
      clean = acc.join(' ') + (hasEtf ? ' ETF' : '');
    }
  }

  return clean || name.trim();
}

/**
 * Returns a clean, compact symbol/code for monospace subtitle badges (e.g. `VOO`, `QCOM`, `120716`, `RELIANCE.NS`),
 * or empty string when `ticker` is actually a verbose fallback scheme name (preventing `HNNIDG-HDFC...` from repeating).
 */
export function formatCompactTickerBadge(ticker?: string): string {
  const raw = (ticker || '').trim();
  if (!raw || raw.toUpperCase() === 'MANUAL') return '';
  if (/\s/.test(raw) || raw.length > 16) return '';
  if (/^[A-Za-z0-9]{4,14}-/.test(raw) && !/\.(NS|BO)$/i.test(raw)) return '';
  return raw;
}
