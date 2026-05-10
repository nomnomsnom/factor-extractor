"""pytest config: make `scan/` importable when tests run from anywhere."""
import sys
from pathlib import Path

# Add the skill folder (the parent of tests/) to sys.path so `import scan.*`
# works regardless of which directory pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
