from loader import load_and_chunk
from extractor import extract_factors_from_chunk
from database import load_factors, save_factors

CHUNKS_TO_PROCESS = 5  # change this as needed
chunks = load_and_chunk("papers/")
all_factors = []
for chunk in chunks[:CHUNKS_TO_PROCESS]:
    factors = extract_factors_from_chunk(chunk)
    all_factors.extend(factors) #factors and all_factors are lists, so use extend
save_factors(all_factors,'factors.json')
print(load_factors('factors.json'))