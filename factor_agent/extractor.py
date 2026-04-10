from dotenv import load_dotenv
import json
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
import re

load_dotenv()


def extract_factors_from_chunk(chunk) -> list:
    chat_model = ChatAnthropic(model="claude-sonnet-4-20250514")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a quantitative finance research assistant.
Extract all financial factors from the provided text.
Return ONLY a valid JSON array with no other text, explanation, or commentary.
Do not include any text before or after the JSON array.
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
    try:
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if match:
            raw = match.group()
        else:
            return []
        # this is not very useful anymore (except block)
    except Exception as e:
        print(f"Something went wrong with the API call: {e}")
        raw = None
    # parse JSON
    try:
        factors = json.loads(raw)
    except json.JSONDecodeError:
        print(f"Decode error, raw was: {repr(raw)}")
        return []
    except Exception as e:
        print(f'raw is None, error:{e}')
        return []
    
    # attach metadata to each factor
    for factor in factors:
        factor["source_paper"] = chunk.metadata.get("source", "unknown")
        factor["page_number"] = chunk.metadata.get("page", 0)
    
    return factors