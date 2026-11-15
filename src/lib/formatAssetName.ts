const UPPER_ACRONYMS = new Set([
  '3M', 'AI', 'AMD', 'AMC', 'AMEX', 'API', 'ASML', 'AT&T', 'AWS', 'AXP',
  'B2B', 'BBC', 'BHEL', 'BMW', 'BNP', 'BOE', 'BP', 'BSE', 'BYD',
  'CBOE', 'CD', 'CDS', 'CDSL', 'CPSE', 'CRM', 'CRSP', 'CSCO', 'CVS',
  'DBS', 'DLF', 'DRAM', 'DSP',
  'EAFE', 'EM', 'EMC', 'EPF', 'EPFO', 'ESG', 'ETF', 'ETFS', 'ETN', 'ETP', 'EU', 'EV',
  'FD', 'FMCG', 'FOF', 'FTSE', 'FX',
  'GBP', 'GDP', 'GE', 'GM', 'GS', 'GSK',
  'HCL', 'HDFC', 'HP', 'HSBC',
  'IBM', 'ICICI', 'IDBI', 'IDCW', 'IDFC', 'IFCI', 'IIFL', 'IND', 'INR', 'IOB', 'IOC', 'IPO', 'IRA', 'IRB', 'IRCTC', 'IRFC', 'ITC', 'ITOT', 'IVV',
  'JIO', 'JNJ', 'JPM',
  'KLA', 'KPMG', 'KPIT',
  'L&T', 'LG', 'LIC', 'LLP', 'LT', 'LTIM', 'LTTS',
  'M&M', 'MBS', 'MCX', 'MF', 'MIT', 'MMTC', 'MOAT', 'MRF', 'MSCI', 'MSE', 'MSTR',
  'NASDAQ', 'NAV', 'NBCC', 'NCC', 'NHPC', 'NIIT', 'NMC', 'NMDC', 'NPS', 'NRE', 'NRO', 'NSE', 'NTPC', 'NVIDIA', 'NXP', 'NYSE',
  'ONGC', 'ORCL',
  'PF', 'PFC', 'PG', 'PNB', 'PPF', 'PPFAS', 'PSU', 'PTC', 'PVR',
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
  nifty: 'Nifty',
  sensex: 'Sensex'
};

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with'
]);

function capitalizeWord(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Formats verbose Indian Mutual Fund scheme names and US / Global brokerage
 * security descriptions (Schwab, IBKR, E*TRADE, INDmoney, Finnhub, TradingView)
 * into clean, concise display labels while keeping key identifiers (AMC, ETF, Share Class).
 */
export function shortenAssetName(name: string, ticker?: string): string {
  if (!name) return '';
  let clean = name.trim();
  const upperTicker = (ticker || '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|L|DE|AS|PA|TO|HK)$/, '');

  // 0. Detect if original input is predominantly ALL-CAPS (typical of US/Indian brokerage statements)
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

  // 3. Remove alphanumeric folio/scheme code prefixes at the start (must contain >=1 digit, e.g. "PP001ZG - ", "102T801 - ", "G202-")
  clean = clean.replace(/^(?=[A-Z0-9]*\d)[A-Z0-9]{2,12}\s*[\-–—]\s*(?=[A-Za-z])/i, '');
  if (upperTicker && upperTicker.length >= 2) {
    const escapedTicker = upperTicker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`^${escapedTicker}\\s+[\\-–—:]\\s+(?=[A-Za-z])`, 'i'), '');
  }

  // 4. Remove Indian MF plan/option noise (handles both " - Direct Plan" and tight "-Growth-Direct Plan")
  const mfStopMarkers = [
    /\s*[\-–—]\s*Direct\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Regular\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Institutional\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Retail\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Plan\s*[A-Z0-9]+\b.*$/i,
    /\s*[\-–—]\s*(Growth|IDCW|Dividend|Payout|Reinvestment|Bonus)\b.*$/i,
    /\b(Direct|Regular)\s+Plan\b.*$/i,
    /\b(Direct|Regular)\s+Growth\b.*$/i,
    /\b(Growth|IDCW)\s+Option\b.*$/i
  ];
  mfStopMarkers.forEach((pat) => {
    clean = clean.replace(pat, '');
  });

  // 5. Strip US / Global brokerage statement boilerplate, ADR/ADS legalese, & column bleed
  // e.g. "ARM HLDGS PLC EQUITY A FUNSPONSORED ADR 1 ADR REPS 1 ORD SHS" -> "ARM HLDGS PLC"
  clean = clean.replace(
    /\b(PLC|INC(?:ORPORATED)?|CORP(?:ORATION)?|LTD|LIMITED|N\.?V\.?|S\.?A\.?|A\.?G\.?|S\.?E\.?)\s+EQUITY\b.*$/i,
    '$1'
  );

  const usCutMarkers = [
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
    /\bSH(?:ARE)?S?\s+NEW\b.*$/i,
    /\bTR(?:UST)?\s+UNIT(?:\s+SER(?:IES)?\s*[A-Z0-9]+)?\b.*$/i,
    /\bUNIT\s+SER(?:IES)?\s*[A-Z0-9]+\b.*$/i,
    /\bPAR\s+\$?[0-9.]+\b.*$/i,
    /\bVESTED\s+RSU\b.*$/i,
    /\bRESTRICTED\s+ST(?:OC)?K\b.*$/i
  ];
  usCutMarkers.forEach((pat) => {
    clean = clean.replace(pat, '');
  });

  if (classLabel) {
    clean = clean
      .replace(/\bCL(?:ASS)?[\s.\-]+[ABC]\b(?:\s+NEW)?/gi, '')
      .replace(/\(\s*CLASS\s+[ABC]\s*\)/gi, '');
  }

  // Collapse repeated ETF issuer trust prefixes (e.g. "Pacer Funds Trust Pacer Data..." -> "Pacer Data...")
  clean = clean
    .replace(/^([A-Za-z0-9&]+)\s+(?:Funds?\s+Trust|ETF\s+Trust|Index\s+F(?:un)?ds?)\s+\1\b/i, '$1')
    .replace(/\b(?:INDEX\s+F(?:UN)?DS?|FUNDS?\s+TR(?:UST)?)\b/gi, '')
    .replace(/\bETF\s+TR(?:UST)?\b(?=.*\bETF\b)/gi, '')
    .replace(/\bETF\s+TR(?:UST)?\b/gi, 'ETF');

  // 6. Peel trailing corporate / registry / jurisdiction suffixes (multiple passes for stacked suffixes like "INC DEL NEW")
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

  // 7. Abbreviate verbose Indian AMC prefixes & expand US brokerage shorthand
  const replacements: [RegExp, string][] = [
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
    [/^Bandhan\b/i, 'Bandhan'],
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

  // 8. Strip trailing "Mutual Fund" / "Fund" / "Scheme" if >=2 words remain (except Provident / Emergency / Pension Fund)
  if (!/\b(Provident|Emergency|Savings|Pension|Chit|Sinking|Endowment)\s+Fund\s*$/i.test(clean)) {
    const strippedTrailing = clean.replace(/\s+(Mutual\s+Fund|Fund|Scheme|Plan|Option)\s*$/i, '').trim();
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
