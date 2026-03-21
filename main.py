from dotenv import load_dotenv
import anthropic
import os
import json

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def extract_factors_from_text(text: str) -> dict:
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="""You are a quantitative finance research assistant.
Extract all financial factors from the provided text.
Return ONLY valid JSON in this format, no other text:
{
  "factors": [
    {
      "name": "",
      "description": "",
      "data_required": []
    }
  ]
}""",
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
This paper examines the momentum factor, defined as the 
12-month return excluding the most recent month. We also 
study the value factor, measured by book-to-market ratio.
"""

result = extract_factors_from_text(sample_text)
print(json.dumps(result, indent=2))