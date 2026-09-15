import json, subprocess, time, os
UA = 'TwoHundredFilings research zihangissmart@gmail.com'
os.makedirs('sec', exist_ok=True)

DUR = ['CY2025', 'CY2024']
INST = ['CY2026Q2I', 'CY2026Q1I', 'CY2025Q4I']

TAGS = [
 ('ResearchAndDevelopmentExpense', 'USD', DUR),
 ('ShareBasedCompensation', 'USD', DUR),
 ('CostOfGoodsAndServicesSold', 'USD', DUR),
 ('CostOfRevenue', 'USD', DUR),
 ('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', DUR),
 ('Revenues', 'USD', DUR),
 ('NoninterestExpense', 'USD', DUR),
 ('NoninterestIncome', 'USD', DUR),
 ('InterestIncomeExpenseNet', 'USD', DUR),
 ('ProvisionForLoanLeaseAndOtherLosses', 'USD', DUR),
 ('PremiumsEarnedNet', 'USD', DUR),
 ('BenefitsLossesAndExpenses', 'USD', DUR),
 ('PolicyholderBenefitsAndClaimsIncurredNet', 'USD', DUR),
 ('AdvertisingExpense', 'USD', DUR),
 ('InventoryNet', 'USD', INST),
 ('RevenueRemainingPerformanceObligation', 'USD', INST),
 ('FinancingReceivableAllowanceForCreditLoss', 'USD', INST),
 ('LoansAndLeasesReceivableNetReportedAmount', 'USD', INST),
 ('FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss', 'USD', INST),
 ('TierOneRiskBasedCapitalToRiskWeightedAssets', 'pure', INST),
 ('ConcentrationRiskPercentage1', 'pure', DUR),
 ('DepositsTotal', 'USD', INST),
]

ok = fail = 0
for tag, unit, frames in TAGS:
    for fr in frames:
        out = 'sec/%s_%s.json' % (tag, fr)
        if os.path.exists(out) and os.path.getsize(out) > 500:
            continue
        url = 'https://data.sec.gov/api/xbrl/frames/us-gaap/%s/%s/%s.json' % (tag, unit, fr)
        r = subprocess.run(['curl', '-sS', '-m', '45', '-A', UA, url, '-o', out], capture_output=True)
        size = os.path.getsize(out) if os.path.exists(out) else 0
        good = r.returncode == 0 and size > 500
        try:
            if good:
                json.load(open(out))
        except Exception:
            good = False
        if good:
            ok += 1
        else:
            fail += 1
            if os.path.exists(out): os.remove(out)
        print(('  ok  ' if good else ' MISS ') + tag + ' ' + fr + ' (' + str(size // 1024) + 'KB)', flush=True)
        time.sleep(0.6)
print('done: %d frames fetched, %d unavailable' % (ok, fail))
