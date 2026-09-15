import json, glob, os

tk = json.load(open('tickers.json'))
cik_of = {}
for v in tk.values():
    cik_of[v['ticker'].upper()] = int(v['cik_str'])
us = json.load(open('us100.json'))
# BRK.B -> BRK-B in SEC file
alias = {'BRK.B': 'BRK-B'}
mine = {}
for u in us:
    t = u['ticker']
    c = cik_of.get(t.upper()) or cik_of.get(alias.get(t, '').upper())
    if c: mine[c] = t
print('tickers mapped to CIK:', len(mine), 'of', len(us))
missing = [u['ticker'] for u in us if not (cik_of.get(u['ticker'].upper()) or cik_of.get(alias.get(u['ticker'], '').upper()))]
print('unmapped:', missing)

def load(tag, frames):
    """newest frame first wins"""
    out = {}
    for fr in frames:
        p = 'sec/%s_%s.json' % (tag, fr)
        if not os.path.exists(p): continue
        try: d = json.load(open(p))
        except Exception: continue
        for row in d.get('data', []):
            t = mine.get(row['cik'])
            if t and t not in out:
                out[t] = {'v': row['val'], 'end': row.get('end'), 'fr': fr}
    return out

DUR = ['CY2025', 'CY2024']
INST = ['CY2026Q2I', 'CY2026Q1I', 'CY2025Q4I']
F = {
 'rd': load('ResearchAndDevelopmentExpense', DUR),
 'sbc': load('ShareBasedCompensation', DUR),
 'cogs': load('CostOfGoodsAndServicesSold', DUR),
 'cogs2': load('CostOfRevenue', DUR),
 'rev1': load('RevenueFromContractWithCustomerExcludingAssessedTax', DUR),
 'rev2': load('Revenues', DUR),
 'nie': load('NoninterestExpense', DUR),
 'nii': load('NoninterestIncome', DUR),
 'nim': load('InterestIncomeExpenseNet', DUR),
 'prov': load('ProvisionForLoanLeaseAndOtherLosses', DUR),
 'prem': load('PremiumsEarnedNet', DUR),
 'ben': load('BenefitsLossesAndExpenses', DUR),
 'claims': load('PolicyholderBenefitsAndClaimsIncurredNet', DUR),
 'adv': load('AdvertisingExpense', DUR),
 'inv': load('InventoryNet', INST),
 'rpo': load('RevenueRemainingPerformanceObligation', INST),
 'loans': load('FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss', INST),
 'loans2': load('LoansAndLeasesReceivableNetReportedAmount', INST),
 'tier1': load('TierOneRiskBasedCapitalToRiskWeightedAssets', INST),
 'conc': load('ConcentrationRiskPercentage1', DUR),
}
for k, v in F.items():
    print('%-8s %3d/100' % (k, len(v)))
json.dump({k: v for k, v in F.items()}, open('sec_raw.json', 'w'))
