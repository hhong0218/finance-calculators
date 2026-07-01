/*!
 * finance-math.js — shared pure math engine for FinCalc
 * Loaded via <script src="/assets/finance-math.js"> on every calculator page.
 *
 * Contains:
 *   - Amortization schedule generation (mortgages, auto/personal/student loans)
 *   - Extra-payment payoff comparison
 *   - Compound-interest / retirement growth projection
 *   - 2026 US federal tax withholding + FICA estimate (paycheck calculator)
 *
 * All functions are pure (no DOM access, no globals mutated besides the
 * FinanceMath namespace itself) so they can be unit-sanity-checked in a
 * plain Node/console context as well as in the browser.
 *
 * IMPORTANT: every calculator on this site is an ESTIMATE only. This file
 * does not constitute financial, tax, or legal advice.
 */
(function (global) {
  "use strict";

  /* ============================================================
   * 1. CORE AMORTIZATION MATH
   * ============================================================ */

  /**
   * Standard fixed-rate loan payment formula:
   *   M = P * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
   * where r = monthly interest rate (annualRate/12), n = number of payments.
   * Falls back to a simple P/n split when the rate is 0.
   *
   * @param {number} principal      Loan amount (>0)
   * @param {number} annualRatePct  Annual interest rate as a PERCENT (e.g. 6.5 for 6.5%)
   * @param {number} termMonths     Number of monthly payments (>0)
   * @returns {number} monthly payment amount (principal + interest only)
   */
  function monthlyPayment(principal, annualRatePct, termMonths) {
    principal = Number(principal) || 0;
    termMonths = Math.round(Number(termMonths) || 0);
    const r = (Number(annualRatePct) || 0) / 100 / 12;
    if (principal <= 0 || termMonths <= 0) return 0;
    if (r === 0) return principal / termMonths;
    const factor = Math.pow(1 + r, termMonths);
    return (principal * r * factor) / (factor - 1);
  }

  /**
   * Generates a full amortization schedule for a fixed-rate loan.
   *
   * @param {Object} opts
   * @param {number} opts.principal       Loan amount
   * @param {number} opts.annualRatePct    Annual interest rate as a percent
   * @param {number} opts.termMonths       Total number of scheduled payments
   * @param {number} [opts.extraMonthly=0] Extra amount applied to principal every payment
   * @param {Date}   [opts.startDate]      First payment date (defaults to today, next month)
   * @param {number} [opts.maxRows=1200]   Safety cap on generated rows (100 years of monthly pmts)
   * @returns {{schedule: Array, summary: Object}}
   *   schedule: [{n, date, payment, principalPaid, interestPaid, extraPaid, balance}]
   *   summary: {monthlyPI, totalPayments, totalInterest, totalPaid, payoffMonths, payoffDate}
   */
  function buildAmortizationSchedule(opts) {
    const principal = Number(opts.principal) || 0;
    const annualRatePct = Number(opts.annualRatePct) || 0;
    const termMonths = Math.round(Number(opts.termMonths) || 0);
    const extraMonthly = Math.max(0, Number(opts.extraMonthly) || 0);
    const maxRows = opts.maxRows || 1200;
    const r = annualRatePct / 100 / 12;

    const basePayment = monthlyPayment(principal, annualRatePct, termMonths);
    const schedule = [];
    let balance = principal;
    let totalInterest = 0;
    let totalPrincipal = 0;
    let totalExtra = 0;

    const startDate = opts.startDate instanceof Date ? new Date(opts.startDate) : nextMonthFirst(new Date());

    let n = 0;
    while (balance > 0.005 && n < maxRows) {
      n++;
      const interestPaid = r === 0 ? 0 : balance * r;
      let scheduledPrincipal = basePayment - interestPaid;
      let extra = extraMonthly;

      // Final payment / overpayment guard: never pay more than the remaining balance.
      if (scheduledPrincipal + extra >= balance) {
        // Pay off exactly this period.
        const remainingPrincipal = balance;
        const principalPaid = remainingPrincipal;
        const paymentThisRow = principalPaid + interestPaid;
        balance = 0;
        totalInterest += interestPaid;
        totalPrincipal += principalPaid;
        // extraPaid reported is whatever portion of the "extra" was actually needed/used
        const extraUsed = Math.max(0, principalPaid - (basePayment - interestPaid));
        totalExtra += extraUsed;
        schedule.push({
          n,
          date: addMonths(startDate, n - 1),
          payment: round2(paymentThisRow),
          principalPaid: round2(principalPaid),
          interestPaid: round2(interestPaid),
          extraPaid: round2(extraUsed),
          balance: 0
        });
        break;
      }

      scheduledPrincipal = Math.max(0, scheduledPrincipal);
      balance -= (scheduledPrincipal + extra);
      totalInterest += interestPaid;
      totalPrincipal += scheduledPrincipal;
      totalExtra += extra;

      schedule.push({
        n,
        date: addMonths(startDate, n - 1),
        payment: round2(scheduledPrincipal + interestPaid + extra),
        principalPaid: round2(scheduledPrincipal),
        interestPaid: round2(interestPaid),
        extraPaid: round2(extra),
        balance: round2(Math.max(0, balance))
      });
    }

    const summary = {
      monthlyPI: round2(basePayment),
      totalPayments: schedule.length,
      totalInterest: round2(totalInterest),
      totalPrincipal: round2(totalPrincipal),
      totalExtra: round2(totalExtra),
      totalPaid: round2(totalPrincipal + totalInterest),
      payoffMonths: schedule.length,
      payoffDate: schedule.length ? schedule[schedule.length - 1].date : startDate
    };

    return { schedule, summary };
  }

  /**
   * Convenience: compare a standard payoff vs. one with extra monthly payments,
   * for the "side-by-side" comparison UX used on loan-payoff-calculator.html.
   *
   * @param {Object} opts {principal, annualRatePct, termMonths, extraMonthly, startDate}
   * @returns {Object} {standard, withExtra, monthsSaved, interestSaved}
   */
  function compareStandardVsExtra(opts) {
    const standard = buildAmortizationSchedule({
      principal: opts.principal,
      annualRatePct: opts.annualRatePct,
      termMonths: opts.termMonths,
      extraMonthly: 0,
      startDate: opts.startDate,
      maxRows: opts.maxRows
    });
    const withExtra = buildAmortizationSchedule({
      principal: opts.principal,
      annualRatePct: opts.annualRatePct,
      termMonths: opts.termMonths,
      extraMonthly: opts.extraMonthly,
      startDate: opts.startDate,
      maxRows: opts.maxRows
    });
    const monthsSaved = Math.max(0, standard.summary.payoffMonths - withExtra.summary.payoffMonths);
    const interestSaved = round2(Math.max(0, standard.summary.totalInterest - withExtra.summary.totalInterest));
    return { standard, withExtra, monthsSaved, interestSaved };
  }

  /* ============================================================
   * 2. MORTGAGE-SPECIFIC HELPERS (taxes / insurance / PMI / HOA)
   * ============================================================ */

  /**
   * Full mortgage monthly payment breakdown (PITI + PMI + HOA).
   * @param {Object} opts
   * @param {number} opts.homePrice
   * @param {number} opts.downPayment        Dollar amount of down payment
   * @param {number} opts.annualRatePct
   * @param {number} opts.termYears
   * @param {number} [opts.annualPropertyTax=0]  Dollar amount PER YEAR
   * @param {number} [opts.annualHomeInsurance=0] Dollar amount PER YEAR
   * @param {number} [opts.pmiMonthly=0]      Monthly PMI dollar amount (0 if down payment >= 20%)
   * @param {number} [opts.hoaMonthly=0]
   * @returns {Object} full breakdown + amortization summary
   */
  function mortgageBreakdown(opts) {
    const homePrice = Number(opts.homePrice) || 0;
    const downPayment = Number(opts.downPayment) || 0;
    const principal = Math.max(0, homePrice - downPayment);
    const termMonths = Math.round((Number(opts.termYears) || 0) * 12);

    const { schedule, summary } = buildAmortizationSchedule({
      principal,
      annualRatePct: opts.annualRatePct,
      termMonths,
      startDate: opts.startDate
    });

    const propertyTaxMonthly = (Number(opts.annualPropertyTax) || 0) / 12;
    const insuranceMonthly = (Number(opts.annualHomeInsurance) || 0) / 12;
    const pmiMonthly = Math.max(0, Number(opts.pmiMonthly) || 0);
    const hoaMonthly = Math.max(0, Number(opts.hoaMonthly) || 0);

    const totalMonthly = summary.monthlyPI + propertyTaxMonthly + insuranceMonthly + pmiMonthly + hoaMonthly;

    return {
      principal: round2(principal),
      downPaymentPct: homePrice > 0 ? round2((downPayment / homePrice) * 100) : 0,
      monthlyPI: summary.monthlyPI,
      propertyTaxMonthly: round2(propertyTaxMonthly),
      insuranceMonthly: round2(insuranceMonthly),
      pmiMonthly: round2(pmiMonthly),
      hoaMonthly: round2(hoaMonthly),
      totalMonthly: round2(totalMonthly),
      totalInterest: summary.totalInterest,
      totalPrincipal: summary.totalPrincipal,
      totalPaidPI: summary.totalPaid,
      payoffDate: summary.payoffDate,
      payoffMonths: summary.payoffMonths,
      schedule
    };
  }

  /* ============================================================
   * 3. COMPOUND INTEREST / RETIREMENT PROJECTION
   * ============================================================ */

  /**
   * Projects year-by-year growth of savings with regular monthly contributions,
   * using monthly compounding: balance_{m} = balance_{m-1} * (1 + r/12) + contribution.
   *
   * This is a deterministic ESTIMATE based on a constant assumed annual return.
   * Real markets do not return a smooth constant rate — actual results will vary.
   *
   * @param {Object} opts
   * @param {number} opts.currentSavings
   * @param {number} opts.monthlyContribution
   * @param {number} opts.annualReturnPct      Assumed constant annual return, as a percent
   * @param {number} opts.years
   * @param {number} [opts.employerMatchPct=0] Employer match as % of monthly contribution (e.g. 50 = 50% match), added on top
   * @param {number} [opts.employerMatchCapMonthly=Infinity] Optional dollar cap on the employer match per month
   * @returns {Object} {yearly: [{year, contributions, employerMatch, growth, balance}], summary}
   */
  function projectRetirementGrowth(opts) {
    const currentSavings = Number(opts.currentSavings) || 0;
    const monthlyContribution = Math.max(0, Number(opts.monthlyContribution) || 0);
    const annualReturnPct = Number(opts.annualReturnPct) || 0;
    const years = Math.max(0, Math.round(Number(opts.years) || 0));
    const employerMatchPct = Math.max(0, Number(opts.employerMatchPct) || 0);
    const employerMatchCapMonthly = opts.employerMatchCapMonthly != null && isFinite(opts.employerMatchCapMonthly)
      ? Number(opts.employerMatchCapMonthly)
      : Infinity;

    const monthlyRate = annualReturnPct / 100 / 12;
    const employerMatchMonthly = Math.min(monthlyContribution * (employerMatchPct / 100), employerMatchCapMonthly);

    let balance = currentSavings;
    let totalContributions = 0;
    let totalEmployerMatch = 0;
    const yearly = [];

    for (let y = 1; y <= years; y++) {
      const balanceStartOfYear = balance;
      let contributionsThisYear = 0;
      let matchThisYear = 0;

      for (let m = 0; m < 12; m++) {
        balance = balance * (1 + monthlyRate);
        balance += monthlyContribution + employerMatchMonthly;
        contributionsThisYear += monthlyContribution;
        matchThisYear += employerMatchMonthly;
      }

      totalContributions += contributionsThisYear;
      totalEmployerMatch += matchThisYear;
      const growthThisYear = balance - balanceStartOfYear - contributionsThisYear - matchThisYear;

      yearly.push({
        year: y,
        contributions: round2(contributionsThisYear),
        employerMatch: round2(matchThisYear),
        growth: round2(growthThisYear),
        balance: round2(balance)
      });
    }

    return {
      yearly,
      summary: {
        startingBalance: round2(currentSavings),
        finalBalance: round2(balance),
        totalContributions: round2(totalContributions),
        totalEmployerMatch: round2(totalEmployerMatch),
        totalGrowth: round2(balance - currentSavings - totalContributions - totalEmployerMatch)
      }
    };
  }

  /* ============================================================
   * 4. 2026 US FEDERAL TAX + FICA ESTIMATE (paycheck calculator)
   * ============================================================
   * Source: IRS Revenue Procedure 2025-32 / IRS newsroom release
   * "IRS releases tax inflation adjustments for tax year 2026" (IR-2025-103),
   * published Oct. 9, 2025. https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
   * FICA wage base: Social Security Administration 2026 COLA fact sheet,
   * https://www.ssa.gov/news/en/cola/factsheets/2026.html — $184,500 wage base for 2026.
   *
   * METHOD NOTE: this uses an "annualize, apply marginal brackets to the
   * standard deduction, de-annualize" approach — NOT the IRS Publication 15-T
   * exact payroll-withholding percentage-method tables (which additionally
   * depend on an employee's Form W-4 elections: filing status checkbox,
   * multiple-jobs worksheet, dependents credit, extra withholding, etc).
   * This is the standard simplification used by most consumer paycheck
   * estimators and gives a very close approximation of a single-job,
   * standard-deduction taxpayer's effective annual federal tax — but your
   * actual paycheck withholding depends on what you filed on your W-4.
   */

  const TAX_YEAR_2026 = {
    year: 2026,
    standardDeduction: {
      single: 16100,
      marriedJointly: 32200,
      headOfHousehold: 24150
    },
    brackets: {
      single: [
        { rate: 0.10, upTo: 12400 },
        { rate: 0.12, upTo: 50400 },
        { rate: 0.22, upTo: 105700 },
        { rate: 0.24, upTo: 201775 },
        { rate: 0.32, upTo: 256225 },
        { rate: 0.35, upTo: 640600 },
        { rate: 0.37, upTo: Infinity }
      ],
      marriedJointly: [
        { rate: 0.10, upTo: 24800 },
        { rate: 0.12, upTo: 100800 },
        { rate: 0.22, upTo: 211400 },
        { rate: 0.24, upTo: 403550 },
        { rate: 0.32, upTo: 512450 },
        { rate: 0.35, upTo: 768700 },
        { rate: 0.37, upTo: Infinity }
      ],
      headOfHousehold: [
        { rate: 0.10, upTo: 17700 },
        { rate: 0.12, upTo: 67450 },
        { rate: 0.22, upTo: 105700 },
        { rate: 0.24, upTo: 201750 },
        { rate: 0.32, upTo: 256200 },
        { rate: 0.35, upTo: 640600 },
        { rate: 0.37, upTo: Infinity }
      ]
    },
    fica: {
      socialSecurityRate: 0.062,
      socialSecurityWageBase: 184500,
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
      additionalMedicareThreshold: {
        single: 200000,
        marriedJointly: 250000,
        headOfHousehold: 200000
      }
    }
  };

  /**
   * Applies a progressive marginal-bracket table to a taxable income amount.
   * @param {number} taxableIncome
   * @param {Array<{rate:number, upTo:number}>} brackets  Ascending, upTo = cumulative ceiling
   * @returns {number} tax owed
   */
  function applyBrackets(taxableIncome, brackets) {
    let tax = 0;
    let lastCap = 0;
    for (const b of brackets) {
      if (taxableIncome <= lastCap) break;
      const taxableInBand = Math.min(taxableIncome, b.upTo) - lastCap;
      if (taxableInBand > 0) tax += taxableInBand * b.rate;
      lastCap = b.upTo;
      if (taxableIncome <= b.upTo) break;
    }
    return tax;
  }

  /**
   * Estimates federal income tax + FICA for a given ANNUAL gross salary.
   * @param {number} annualGross
   * @param {'single'|'marriedJointly'|'headOfHousehold'} filingStatus
   * @returns {Object} {annualFederalTax, annualSocialSecurity, annualMedicare, annualAdditionalMedicare, annualFicaTotal, effectiveFederalRate}
   */
  function estimateAnnualFederalAndFica(annualGross, filingStatus) {
    const status = TAX_YEAR_2026.brackets[filingStatus] ? filingStatus : "single";
    const gross = Math.max(0, Number(annualGross) || 0);
    const stdDeduction = TAX_YEAR_2026.standardDeduction[status];
    const taxableIncome = Math.max(0, gross - stdDeduction);
    const annualFederalTax = applyBrackets(taxableIncome, TAX_YEAR_2026.brackets[status]);

    const ssWageBase = TAX_YEAR_2026.fica.socialSecurityWageBase;
    const ssTaxableWages = Math.min(gross, ssWageBase);
    const annualSocialSecurity = ssTaxableWages * TAX_YEAR_2026.fica.socialSecurityRate;

    const annualMedicare = gross * TAX_YEAR_2026.fica.medicareRate;
    const addlThreshold = TAX_YEAR_2026.fica.additionalMedicareThreshold[status];
    const annualAdditionalMedicare = Math.max(0, gross - addlThreshold) * TAX_YEAR_2026.fica.additionalMedicareRate;

    const annualFicaTotal = annualSocialSecurity + annualMedicare + annualAdditionalMedicare;

    return {
      taxYear: TAX_YEAR_2026.year,
      standardDeductionUsed: stdDeduction,
      taxableIncome: round2(taxableIncome),
      annualFederalTax: round2(annualFederalTax),
      annualSocialSecurity: round2(annualSocialSecurity),
      annualMedicare: round2(annualMedicare),
      annualAdditionalMedicare: round2(annualAdditionalMedicare),
      annualFicaTotal: round2(annualFicaTotal),
      effectiveFederalRate: gross > 0 ? round2((annualFederalTax / gross) * 100) : 0
    };
  }

  /**
   * Full paycheck breakdown for a given pay frequency.
   * @param {Object} opts
   * @param {number} opts.grossPerPeriod    Gross pay for ONE pay period (before any tax)
   * @param {'weekly'|'biweekly'|'semimonthly'|'monthly'|'annual'} opts.frequency
   * @param {'single'|'marriedJointly'|'headOfHousehold'} opts.filingStatus
   * @param {number} [opts.stateLocalRatePct=0] User-provided flat state+local rate, as a percent
   * @param {number} [opts.preTaxDeductionsPerPeriod=0] e.g. 401k/HSA — reduces the taxable base
   * @returns {Object} per-period AND annualized breakdown
   */
  function paycheckBreakdown(opts) {
    const periodsPerYear = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 }[opts.frequency] || 26;
    const grossPerPeriod = Math.max(0, Number(opts.grossPerPeriod) || 0);
    const preTaxPerPeriod = Math.max(0, Number(opts.preTaxDeductionsPerPeriod) || 0);
    const stateLocalRatePct = Math.max(0, Number(opts.stateLocalRatePct) || 0);

    const annualGross = grossPerPeriod * periodsPerYear;
    const annualPreTax = preTaxPerPeriod * periodsPerYear;
    const annualGrossForFederal = Math.max(0, annualGross - annualPreTax);

    const fedFica = estimateAnnualFederalAndFica(annualGrossForFederal, opts.filingStatus);
    const annualStateLocal = annualGrossForFederal * (stateLocalRatePct / 100);

    const annualNet = annualGross - annualPreTax - fedFica.annualFederalTax - fedFica.annualFicaTotal - annualStateLocal;

    function perPeriod(annualAmount) {
      return round2(annualAmount / periodsPerYear);
    }

    return {
      frequency: opts.frequency,
      periodsPerYear,
      perPeriod: {
        gross: round2(grossPerPeriod),
        preTaxDeductions: round2(preTaxPerPeriod),
        federalTax: perPeriod(fedFica.annualFederalTax),
        socialSecurity: perPeriod(fedFica.annualSocialSecurity),
        medicare: perPeriod(fedFica.annualMedicare + fedFica.annualAdditionalMedicare),
        stateLocal: perPeriod(annualStateLocal),
        net: perPeriod(annualNet)
      },
      annual: {
        gross: round2(annualGross),
        preTaxDeductions: round2(annualPreTax),
        federalTax: fedFica.annualFederalTax,
        socialSecurity: fedFica.annualSocialSecurity,
        medicare: round2(fedFica.annualMedicare + fedFica.annualAdditionalMedicare),
        stateLocal: round2(annualStateLocal),
        net: round2(annualNet),
        effectiveFederalRate: fedFica.effectiveFederalRate,
        standardDeductionUsed: fedFica.standardDeductionUsed,
        taxableIncome: fedFica.taxableIncome
      }
    };
  }

  /* ============================================================
   * 5. SMALL SHARED UTILITIES
   * ============================================================ */

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function addMonths(date, months) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function nextMonthFirst(date) {
    const d = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return d;
  }

  function formatCurrency(n, opts) {
    opts = opts || {};
    const digits = opts.digits != null ? opts.digits : 0;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(Number(n) || 0);
    } catch (e) {
      return "$" + (Number(n) || 0).toFixed(digits);
    }
  }

  function formatDate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function toCSV(rows, headers) {
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(",")];
    for (const row of rows) {
      lines.push(row.map(esc).join(","));
    }
    return lines.join("\r\n");
  }

  function downloadCSV(filename, rows, headers) {
    const csv = toCSV(rows, headers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ============================================================
   * PUBLIC API
   * ============================================================ */
  const FinanceMath = {
    TAX_YEAR_2026,
    monthlyPayment,
    buildAmortizationSchedule,
    compareStandardVsExtra,
    mortgageBreakdown,
    projectRetirementGrowth,
    estimateAnnualFederalAndFica,
    paycheckBreakdown,
    applyBrackets,
    round2,
    addMonths,
    formatCurrency,
    formatDate,
    toCSV,
    downloadCSV
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceMath;
  } else {
    global.FinanceMath = FinanceMath;
  }
})(typeof window !== "undefined" ? window : globalThis);
