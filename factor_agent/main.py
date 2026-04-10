from loader import load_and_chunk
from extractor import extract_factors_from_chunk
from database import load_factors, save_factors, reset_db
from database import clear_factors
from validator import validate_factor

CHUNKS_TO_PROCESS=10
reset_db()
try:
    chunks = load_and_chunk("papers/")
except FileNotFoundError:
    print("path doesnt exist")
    chunks=[]
all_factors = []
for i, chunk in enumerate(chunks[:CHUNKS_TO_PROCESS]):
    print(f"Processing chunk [{i+1}/{CHUNKS_TO_PROCESS}]")
    factors = extract_factors_from_chunk(chunk)
    for factor in factors:
        validated = validate_factor(factor)
        if validated["is_valid"]:# and validated["confidence"] >= 3:
            all_factors.append(validated) 
save_factors(all_factors)
print(load_factors())