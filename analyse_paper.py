from dotenv import load_dotenv
import anthropic
import os
import json

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def analyse_paper(text: str) -> dict:
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="""
Extract methodology and sample size from the given text.
Return ONLY valid JSON in this format, no other text:
{
  "factors": [
    {
      "name": "",
      "description": "",
      "data_required": []
    }
  ],
    "research_papers": [
    {
      "name": "",
      "methodology": "",
      "sample_size": ""
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
name: snom's practice paper
This paper examines the momentum factor, defined as the 
12-month return excluding the most recent month. We also 
study the value factor, measured by book-to-market ratio.
This study uses OLS regression as the primary methodology.
The sample consists of 5,000 US equities from 1990 to 2020,
sourced from CRSP database.
"""

result = analyse_paper(sample_text)
with open('analyse_paper.json','w')as file:
   json.dump(result,file,indent=4)
print('\n\nbeautiful code by snom')