"""A general-purpose multi-agent graph.

    lead -> research agents (0..N) -> worker agents (0..M) -> compiler -> actions (0..K)

The lead agent decides the shape of each run, so the same graph handles a
one-line lookup and a multi-round deep-research task; the compiler can send work
back to the lead when coverage falls short of the bar.
"""

from .config import GraphConfig
from .runner import run, stream

__all__ = ["GraphConfig", "run", "stream"]
__version__ = "0.1.0"
