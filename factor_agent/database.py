import json

def save_factors(factors: list,json_name) -> None:
    try:
        with open(json_name, 'r') as file:
            current_factors = json.load(file)
    except FileNotFoundError:
        current_factors = []
    
    existing_names = [f["factor_name"] for f in current_factors]
    for factor in factors:
        if factor["factor_name"] not in existing_names:
            current_factors.append(factor)
    
    with open(json_name, 'w') as file:
        json.dump(current_factors, file, indent=4)

def load_factors(json_name) -> list:
    try:
        with open(json_name, 'r') as file:
            return json.load(file)
    except FileNotFoundError:
        return []