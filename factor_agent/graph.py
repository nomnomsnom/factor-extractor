from typing import TypedDict
from langgraph.graph import StateGraph, END
from loader import load_and_chunk
from extractor import extract_factors_from_chunk
from validator import validate_factor
from database import save_factors, reset_db
CHUNKS_TO_PROCESS=20
#STATE
class AgentState(TypedDict):
    chunks:list
    current_chunk_index:int
    raw_factors:list
    validated_factors:list


def extract_node(state: AgentState) -> dict:
    chunk = state["chunks"][state["current_chunk_index"]]
    factors = extract_factors_from_chunk(chunk)
    return {
        "raw_factors": factors,
        "current_chunk_index": state["current_chunk_index"] + 1
    }

def validate_node(state: AgentState) -> dict:
    newly_validated = []
    for factor in state["raw_factors"]:
        validated = validate_factor(factor)
        if validated["is_valid"] and validated["confidence"] >= 3:
            newly_validated.append(validated)
    return {
        "validated_factors": state["validated_factors"] + newly_validated,
        "raw_factors": []
    }

def save_node(state: AgentState):
    save_factors(state["validated_factors"])
    return {}
def should_continue(state: AgentState):
    if state["current_chunk_index"]<CHUNKS_TO_PROCESS:
        return "extract"
    else:
        return "save"


# build the graph
graph_builder = StateGraph(AgentState)

# add nodes
graph_builder.add_node("extract", extract_node)
graph_builder.add_node("validate",validate_node)
graph_builder.add_node("save",save_node)

# add edges
graph_builder.set_entry_point("extract")
# add edge from extract to validate
graph_builder.add_edge("extract","validate")
# add conditional edge from validate using should_continue
graph_builder.add_conditional_edges(
    "validate",
    should_continue,
    {"extract": "extract", "save": "save"}
)
# add edge from save to END
graph_builder.add_edge("save",END)
graph = graph_builder.compile()


if __name__ == "__main__":
    reset_db()
    chunks = load_and_chunk("papers/")
    
    result = graph.invoke({
        "chunks": chunks,
        "current_chunk_index": 0,
        "raw_factors": [],
        "validated_factors": []
    })
    #this counts duplicates as well.
    # print(f"Done. Saved {len(result['validated_factors'])} factors.")

    from database import load_factors
    print(f"Done. {len(load_factors())} unique factors in database.")