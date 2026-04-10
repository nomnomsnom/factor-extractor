import json
import sqlite3
import json

def to_json(value):
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return str(value)
def get_connection():
    try:
        conn = sqlite3.connect("factors.db")
        #access values using column names
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f'database connection failed: {e}')
        return None

def create_table():
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS factors (
            id           INTEGER PRIMARY KEY,
            factor_name  TEXT,
            description  TEXT,
            data_required TEXT,
            methodology  TEXT,
            source_paper TEXT,
            page_number  INTEGER,
            is_valid     INTEGER,
            confidence   INTEGER,
            reason       TEXT
        )
    """)
    conn.commit()
    conn.close()

def save_factors(factors: list) -> None:
    create_table()
    conn = get_connection()

# get existing factor keys to avoid duplicates
    existing = conn.execute("SELECT factor_name, source_paper, page_number FROM factors").fetchall()
    


    for factor in factors:
        try:
        # check if this factor name already exists from this paper
            existing = conn.execute(
                "SELECT id, confidence FROM factors WHERE factor_name = ? AND source_paper = ?",
                (factor["factor_name"], factor.get("source_paper", ""))
            ).fetchone()

            if existing is None:
            # not seen before — insert it
                conn.execute("""
                    INSERT INTO factors (factor_name, description, data_required, methodology, is_valid, confidence, reason, source_paper, page_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    factor.get("factor_name", ""),
                    factor.get("description", ""),
                    to_json(factor.get("data_required", "")),
                    factor.get("methodology", ""),
                    factor.get("is_valid",""),
                    factor.get("confidence", 0),
                    factor.get("reason", ""),
                    factor.get("source_paper", ""),
                    factor.get("page_number", 0),
                ))
            elif factor.get("confidence", 0) > existing["confidence"]:
            # seen before but this version has higher confidence — update it
                conn.execute("""
                    UPDATE factors SET description=?, data_required=?, methodology=?, is_valid=?, confidence=?, reason=?, page_number=?
                    WHERE id=?
                """, (
                    factor["description"],
                    to_json(factor.get("data_required","")),
                    factor.get("methodology", ""),
                    factor.get("is_valid",""),
                    factor.get("confidence", 0),
                    factor.get("reason", ""),
                    factor.get("page_number", 0),
                    existing["id"]
                ))
        except sqlite3.Error as e:
            print(f"failed to insert {factor.get('factor_name', 'unknown')}: {e}")
            continue

    conn.commit()
    conn.close()

def load_factors() -> list:
    create_table()
    try:
        conn = get_connection()
    except sqlite3.Error as e:
        print(f'failed to establish connection: {e}')
        return []
    try:
        rows = conn.execute("SELECT * FROM factors").fetchall()
        conn.close()

        factors = []
        for row in rows:
            factors.append({
                "factor_name":  row["factor_name"],
                "description":  row["description"],
                "data_required": json.loads(row["data_required"] or "[]"),
                "methodology":  row["methodology"],
                "source_paper": row["source_paper"],
                "page_number":  row["page_number"],
                "is_valid":     bool(row["is_valid"]),
                "confidence":   row["confidence"],
                "reason":       row["reason"]
            })
        return factors
    except Exception as e:
        print(f'error occurred: {e}')
        return []

def clear_factors():
    conn = get_connection()
    conn.execute("DELETE FROM factors")
    conn.commit()
    conn.close()

def reset_db():
    conn = get_connection()
    conn.execute("DROP TABLE IF EXISTS factors")
    conn.commit()
    conn.close()
    create_table()