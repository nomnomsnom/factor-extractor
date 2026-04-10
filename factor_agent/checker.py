# from database import load_factors

# factors = load_factors()
# print(f"Total factors saved: {len(factors)}")
# for f in factors[:5]:
#     print(f["factor_name"], "-", f["source_paper"], "page", f["page_number"])

# from database import load_factors

# factors = load_factors()
# names = [f["factor_name"] for f in factors]
# print(f"Total: {len(factors)}")
# print(f"Unique names: {len(set(names))}")
from database import load_factors
from validator import validate_factor

factors = load_factors()
result = validate_factor(factors[0])
print(result)