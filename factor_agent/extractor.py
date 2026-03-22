from dotenv import load_dotenv
import json
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

load_dotenv()

def extract_factors_from_chunk(chunk) -> list:
    chat_model = ChatAnthropic(model="claude-sonnet-4-20250514")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a quantitative finance research assistant.
Extract all financial factors from the provided text.
Return ONLY a valid JSON array, no other text.
Return an empty array [] if no factors are present.
Use this format:
[
  {{
    "factor_name": "",
    "description": "",
    "data_required": [],
    "methodology": ""
  }}
]"""),
        ("human", "{text}")
    ])
    
    chain = prompt | chat_model | StrOutputParser()
    raw = chain.invoke({"text": chunk.page_content})
    
    # clean markdown fences
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    
    # parse JSON
    try:
        factors = json.loads(raw)
    except json.JSONDecodeError:
        return []
    
    # attach metadata to each factor
    for factor in factors:
        factor["source_paper"] = chunk.metadata.get("source", "unknown")
        factor["page_number"] = chunk.metadata.get("page", 0)
    
    return factors