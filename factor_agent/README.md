# Financial Factor Extraction Agent

Extracts financial factors (measurable variables that predict asset returns) from academic PDF papers using an AI pipeline built with LangGraph.
## How it works
1 Load PDFs and split them into small text chunks
 2 Loop through first 10 chunks
3 For each chunk:
   • Extract financial factors using Claude (Anthropic API)
   • Validate each factor using Claude with confidence scoring
   • Keep only valid factors with confidence ≥ 3
 4 Save all valid factors to database
 5 Print results

## Setup
Steps to install and run:
1. Clone the repo
2. Create a venv and activate it
3. pip install -r requirements.txt
4. Add your ANTHROPIC_API_KEY to a .env file
5. Run python main.py

## Output
SQLite database of extracted factors.

## Tech stack
- Python 3.11
- LangChain / LangGraph
- Claude Sonnet (Anthropic API)
-SQLite
