import json

def save_factors(factors: list) -> None:
    try:
        with open('factors.json', 'r') as file:
            current_factors = json.load(file)
    except FileNotFoundError:
        current_factors = []
    
    existing_names = [f["factor_name"] for f in current_factors]
    for factor in factors:
        if factor["factor_name"] not in existing_names:
            current_factors.append(factor)
    
    with open('factors.json', 'w') as file:
        json.dump(current_factors, file, indent=4)

def load_factors() -> list:
    try:
        with open('factors.json', 'r') as file:
            return json.load(file)
    except FileNotFoundError:
        return []