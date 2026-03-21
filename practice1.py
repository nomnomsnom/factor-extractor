from dotenv import load_dotenv
import anthropic
import os
import json

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def extract_methodology_sample_size(text: str) -> dict:
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="""
Extract methodology and sample size from the given text.
Return ONLY valid JSON in this format, no other text:
{
    "research_papers":[
        {
            "name":"",
            "methodology":"",
            "sample_size":""   
        }
    ]
}
""",
        messages=[
            {"role": "user", "content": text}
        ]
    )
    
    raw = response.content[0].text
# strip markdown code fences if present
    raw = raw.strip()
    if raw.startswith("```"):
      raw = raw.split("```")[1]  # get content between fences
      if raw.startswith("json"):
        raw = raw[4:]  # remove the "json" label
    raw = raw.strip()
    return json.loads(raw)

sample_text = """
This study uses OLS regression as the primary methodology.
The sample consists of 5,000 US equities from 1990 to 2020,
sourced from CRSP database.
"""

result = extract_methodology_sample_size(sample_text)
print(json.dumps(result, indent=2))