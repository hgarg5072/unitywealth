import * as XLSX from "xlsx";
import axios from "axios";
import {
  RealEstateProperty,
  RealEstateDemand,
  RealEstateSwipe,
  RealEstateLoanTx,
  RealEstateFundOrigin
} from "../types";

function excelSerialToIso(val: any): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number" && val > 35000 && val < 70000) {
    const utcMs = Math.round((val - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    return d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const num = Number(s);
  if (!isNaN(num) && num > 35000 && num < 70000) {
    const utcMs = Math.round((num - 25569) * 86400 * 1000);
    return new Date(utcMs).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return "";
}

function toNum(val: any): number {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[₹$,\s]/g, "").trim();
    if (!cleaned || cleaned === "-") return 0;
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function inferImpliedAnnualRate(principalINR: number, tenureMonths: number, targetEmiINR: number): number {
  if (principalINR <= 0 || tenureMonths <= 0 || targetEmiINR <= 0) return 8.5;
  if (targetEmiINR * tenureMonths <= principalINR) return 0;
  let lo = 0.5;
  let hi = 20.0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const r = mid / 12 / 100;
    const factor = Math.pow(1 + r, tenureMonths);
    const emi = (principalINR * r * factor) / (factor - 1);
    if (emi < targetEmiINR) lo = mid;
    else hi = mid;
  }
  return +((lo + hi) / 2).toFixed(2);
}

function parseFundOriginAmount(label: string): number {
  const mCr = label.match(/(\d+(?:\.\d+)?)\s*cr/i);
  if (mCr) return Math.round(Number(mCr[1]) * 1_00_00_000);
  const mLakh = label.match(/(\d+(?:\.\d+)?)\s*l(?:akh)?\b/i);
  if (mLakh) return Math.round(Number(mLakh[1]) * 1_00_000);
  const mRaw = label.match(/(\d{5,9})/);
  if (mRaw) return Number(mRaw[1]);
  return 0;
}

export async function fetchGoogleSheetXlsxBuffer(sheetUrl: string): Promise<Buffer> {
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error("Invalid Google Sheets URL. Expected https://docs.google.com/spreadsheets/d/<ID>/...");
  }
  const sheetId = match[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const resp = await axios.get(exportUrl, {
    responseType: "arraybuffer",
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (st) => st >= 200 && st < 400
  });
  const contentType = String(resp.headers["content-type"] || "").toLowerCase();
  const buf = Buffer.from(resp.data);
  if (contentType.includes("text/html") || buf.slice(0, 20).toString("utf8").trim().startsWith("<!DOCTYPE")) {
    throw new Error(
      "Google Sheet requires view access. Set sharing on the Google Sheet to 'Anyone with the link -> Viewer' (or upload the .xlsx file directly)."
    );
  }
  return buf;
}

export function parseRealEstateWorkbook(
  buffer: Buffer,
  opts: {
    householdId: string;
    propertyName?: string;
    sheetUrl?: string;
    members?: { id: string; name: string }[];
  }
): RealEstateProperty {
  const wb = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellDates: false });
  const sheetNames = wb.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error("Workbook has no sheets");
  }

  const sheet1 = wb.Sheets[sheetNames[0]];
  const rows1: any[][] = XLSX.utils.sheet_to_json(sheet1, { header: 1, raw: true, defval: "" });

  // Extract formula hints (e.g. P2 = 1.1/2.9 -> 2.9 Cr agreement value)
  let agreementValueINR = 2_90_00_000;
  let targetSelfRatioPct = 37.93;
  const p2Cell = sheet1["P2"];
  if (p2Cell) {
    const pVal = toNum(p2Cell.v);
    if (pVal > 0 && pVal <= 1) targetSelfRatioPct = +(pVal * 100).toFixed(2);
    else if (pVal > 1 && pVal <= 100) targetSelfRatioPct = +pVal.toFixed(2);
    if (typeof p2Cell.f === "string") {
      const mDiv = p2Cell.f.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (mDiv) {
        const denom = Number(mDiv[2]);
        if (denom > 0.5 && denom < 50) {
          agreementValueINR = Math.round(denom * 1_00_00_000);
        }
      }
    }
  }

  const members = opts.members || [];
  const resolveMemberTag = (text: string): string => {
    const low = text.toLowerCase();
    if (/\b(papa|dad|father|mom|mother|parents|gift)\b/.test(low)) return "family_external";
    for (const m of members) {
      const first = (m.name || "").trim().split(/\s+/)[0].toLowerCase();
      if (first && first.length >= 3 && low.includes(first)) return m.id;
      if ((first === "nisha" && low.includes("nishu")) || (first === "nishu" && low.includes("nisha"))) {
        return m.id;
      }
    }
    return members[0]?.id || "self";
  };

  const demands: RealEstateDemand[] = [];
  const fundOrigins: RealEstateFundOrigin[] = [];
  let currentDemand: RealEstateDemand | null = null;
  let demandCounter = 0;

  // Track L/M/N/Q forward planning columns
  interface ForwardPlanRow {
    rowIndex: number;
    totalPaidYetL: number;
    paidByLoanM: number;
    selfFundN: number;
    noteQ: string;
    dueDateA: string;
    amountB: number;
  }
  const forwardRows: ForwardPlanRow[] = [];
  let lastPaidTotalL = 0;
  let lastPaidLoanM = 0;
  let lastPaidSelfN = 0;

  for (let r = 1; r < rows1.length; r++) {
    const row = rows1[r] || [];
    const rawA = row[0];
    const rawB = row[1];
    const rawC = row[2];
    const rawD = row[3];
    const rawE = String(row[4] || "").trim();
    const rawF = row[5];
    const rawG = row[6];
    const rawH = row[7];
    const rawI = String(row[8] || "").trim();
    const rawJ = String(row[9] || "").trim();
    const rawL = toNum(row[11]);
    const rawM = toNum(row[12]);
    const rawN = toNum(row[13]);
    const rawQ = String(row[16] || "").trim();

    if (rawJ) {
      const amt = parseFundOriginAmount(rawJ);
      fundOrigins.push({
        id: `fo_${r}`,
        label: rawJ,
        amountINR: amt,
        memberTag: resolveMemberTag(rawJ)
      });
    }

    const strA = String(rawA ?? "").trim();
    const isTds = /^tds$/i.test(strA);
    const isStamp = /stamp\s*duty|registration/i.test(strA);
    const dueDateIso = !isTds && !isStamp ? excelSerialToIso(rawA) : "";
    const demandAmt = toNum(rawB);
    const payDateIso = excelSerialToIso(rawC);
    const payAmt = toNum(rawD);

    if (rawQ) {
      forwardRows.push({
        rowIndex: r,
        totalPaidYetL: rawL,
        paidByLoanM: rawM,
        selfFundN: rawN,
        noteQ: rawQ,
        dueDateA: dueDateIso,
        amountB: demandAmt
      });
    } else if (rawL > 0) {
      lastPaidTotalL = rawL;
      lastPaidLoanM = rawM;
      lastPaidSelfN = rawN;
    }

    if (dueDateIso && demandAmt > 0) {
      demandCounter++;
      currentDemand = {
        id: `dem_${demandCounter}`,
        title: `Installment ${demandCounter}`,
        dueDate: dueDateIso,
        demandAmountINR: demandAmt,
        status: "paid",
        planNote: rawQ || undefined,
        swipes: []
      };
      demands.push(currentDemand);
    }

    if ((payAmt > 0 || isTds || isStamp) && currentDemand) {
      const recvNum = toNum(rawF);
      const isLoan = /^loan$/i.test(rawE);
      const category: RealEstateSwipe["category"] = isTds
        ? "tds"
        : isStamp
        ? "stamp_duty"
        : "installment";

      const resolvedPaid = payAmt > 0 ? payAmt : demandAmt;
      const resolvedRecv =
        category === "tds" || category === "stamp_duty"
          ? resolvedPaid
          : recvNum > 0
          ? recvNum
          : resolvedPaid;
      const explicitFee = toNum(rawG);
      const ccFee =
        category === "installment"
          ? explicitFee > 0
            ? explicitFee
            : Math.max(0, resolvedPaid - resolvedRecv)
          : 0;

      if (resolvedPaid > 0) {
        currentDemand.swipes.push({
          id: `sw_${r}`,
          paymentDate: payDateIso || currentDemand.dueDate || "",
          paymentAmountINR: resolvedPaid,
          paymentMethod: rawE || (isLoan ? "Loan" : "Net Banking"),
          isLoanFunded: isLoan,
          receivedByBuilderINR: resolvedRecv,
          ccChargesINR: ccFee,
          pointsEarned: toNum(rawH),
          category,
          notes: rawI || undefined
        });
      }
    }
  }

  // Detect copy-pasted template swipes on forward-planned demands (e.g. June row copying March swipes verbatim)
  for (let i = 1; i < demands.length; i++) {
    const prev = demands[i - 1];
    const curr = demands[i];
    const prevSig = prev.swipes
      .filter((s) => s.category === "installment")
      .map((s) => `${s.paymentDate}:${s.paymentAmountINR}:${s.paymentMethod}`)
      .join("|");
    const currSig = curr.swipes
      .filter((s) => s.category === "installment")
      .map((s) => `${s.paymentDate}:${s.paymentAmountINR}:${s.paymentMethod}`)
      .join("|");

    if (prevSig && prevSig === currSig && curr.planNote) {
      // Remove template swipes; convert this and subsequent forwardRows into clean planned milestones!
      demands.splice(i, 1);
      break;
    }
  }

  // Build clean Planned Demands from forwardRows (Columns L..Q)
  let runningL = lastPaidTotalL;
  let runningM = lastPaidLoanM;
  let runningN = lastPaidSelfN;
  for (const fr of forwardRows) {
    const deltaTotal = fr.totalPaidYetL > runningL ? fr.totalPaidYetL - runningL : fr.amountB;
    const deltaLoan = Math.max(0, fr.paidByLoanM - runningM);
    const deltaSelf = Math.max(0, fr.selfFundN - runningN);
    if (fr.totalPaidYetL > 0) runningL = fr.totalPaidYetL;
    if (fr.paidByLoanM > 0) runningM = fr.paidByLoanM;
    if (fr.selfFundN > 0) runningN = fr.selfFundN;

    if (deltaTotal > 0) {
      demandCounter++;
      const noteLow = fr.noteQ.toLowerCase();
      const plannedFunding: RealEstateDemand["plannedFunding"] =
        deltaLoan > 0 && deltaSelf > 0
          ? "split"
          : noteLow.includes("loan") && !noteLow.includes("card")
          ? "loan"
          : noteLow.includes("card")
          ? "self_card"
          : deltaLoan > deltaSelf
          ? "loan"
          : "self_card";

      demands.push({
        id: `dem_plan_${fr.rowIndex}`,
        title: `Planned: ${fr.noteQ}`,
        dueDate: fr.dueDateA || undefined,
        demandAmountINR: deltaTotal,
        status: "planned",
        plannedFunding,
        plannedSelfINR: plannedFunding === "self_card" ? deltaTotal : deltaSelf,
        plannedLoanINR: plannedFunding === "loan" ? deltaTotal : deltaLoan,
        planNote: fr.noteQ,
        swipes: []
      });
    }
  }

  // Parse Sheet 2: Loan Payments
  const loanLedger: RealEstateLoanTx[] = [];
  let sanctionedLimitINR = 1_80_00_000;
  let bankTenureYears = 30;
  let targetTenureYears = 15;
  let targetMonthlyEmiINR = 1_64_315;
  let minMonthlyEmiINR = 11_000;
  let plannedPrepaymentINR = 60_00_000;
  let loanNote = "";

  const loanSheetName = sheetNames.find((n) => /loan/i.test(n)) || sheetNames[1];
  if (loanSheetName && wb.Sheets[loanSheetName]) {
    const rows2: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[loanSheetName], {
      header: 1,
      raw: true,
      defval: ""
    });

    // Inspect header row for narrative note (e.g. G1)
    const headerRow = rows2[0] || [];
    for (const cell of headerRow) {
      const txt = String(cell || "").trim();
      if (txt.length > 40) {
        loanNote = txt;
        const mLoan = txt.match(/loan\s+of\s+(\d+(?:\.\d+)?)\s*cr/i);
        if (mLoan) sanctionedLimitINR = Math.round(Number(mLoan[1]) * 1_00_00_000);
        const mPlot = txt.match(/(\d+(?:\.\d+)?)\s*l\b/i);
        if (mPlot) plannedPrepaymentINR = Math.round(Number(mPlot[1]) * 1_00_000);
      }
    }

    for (let r = 1; r < rows2.length; r++) {
      const row = rows2[r] || [];
      const dt = excelSerialToIso(row[0]);
      const disb = toNum(row[1]);
      const paidInst = toNum(row[3]);
      const expInst = toNum(row[4]);
      const minInst = toNum(row[5]);

      if (expInst > 0) targetMonthlyEmiINR = expInst;
      if (minInst > 0) minMonthlyEmiINR = minInst;

      if (disb > 0) {
        loanLedger.push({
          id: `ln_disb_${r}`,
          date: dt || new Date().toISOString().slice(0, 10),
          type: "disbursement",
          amountINR: disb,
          notes: `Tranche Disbursement`
        });
      }
      if (paidInst > 0) {
        loanLedger.push({
          id: `ln_emi_${r}`,
          date: dt || new Date().toISOString().slice(0, 10),
          type: "emi",
          amountINR: paidInst,
          expectedEmiINR: expInst > 0 ? expInst : targetMonthlyEmiINR,
          minEmiINR: minInst > 0 ? minInst : undefined,
          notes:
            expInst > 0 && paidInst > expInst
              ? "Includes shortfall catch-up"
              : undefined
        });
      }
    }
  }

  const impliedRate = inferImpliedAnnualRate(
    sanctionedLimitINR,
    targetTenureYears * 12,
    targetMonthlyEmiINR
  );

  const ownershipSplit =
    members.length >= 2
      ? [
          { memberId: members[0].id, sharePct: 50 },
          { memberId: members[1].id, sharePct: 50 }
        ]
      : members.length === 1
      ? [{ memberId: members[0].id, sharePct: 100 }]
      : [];

  return {
    id: `re_${Date.now()}`,
    householdId: opts.householdId,
    name: opts.propertyName?.trim() || "Primary Residence",
    agreementValueINR,
    targetSelfRatioPct,
    includeInNetWorth: true,
    useManualTotals: false,
    manualSelfPaidINR: 70_00_000,
    manualLoanDisbursedINR: 50_00_000,
    pointValueINR: 0.8,
    ownershipSplit,
    loanConfig: {
      lender: "Home Loan",
      sanctionedLimitINR,
      interestRatePct: impliedRate,
      bankTenureYears,
      targetTenureYears,
      targetMonthlyEmiINR,
      minMonthlyEmiINR,
      emiDayOfMonth: 23,
      plannedPrepaymentINR,
      note: loanNote || undefined
    },
    sheetUrl: opts.sheetUrl || undefined,
    demands,
    loanLedger,
    fundOrigins,
    updatedAt: Date.now()
  };
}
