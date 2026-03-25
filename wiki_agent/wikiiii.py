"""
Wikipedia NPOV Dispute Study
Compares monthly view counts of NPOV-tagged vs non-tagged articles (2024 onwards)
"""

import requests
import sqlite3
import time
import random
from datetime import datetime

#parameters
SAMPLE_SIZE = 100          # articles per category
START_MONTH = "2024010100" # January 2024 YYYYMMDDHR btw
END_MONTH   = "2026033000" # march 2026
DB_PATH     = "wiki_study.db"
HEADERS     = {"User-Agent": "WikiStudy/1.0 (research project; contact@example.com)"} #wiki requests some info
#ProjectName/Version (description; contact) wiki format

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id          INTEGER PRIMARY KEY,
            title       TEXT UNIQUE,
            is_npov     INTEGER,  -- 1 = NPOV tagged, 0 = non-tagged
            fetched_at  TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS views (
            id          INTEGER PRIMARY KEY,
            title       TEXT,
            month       TEXT,
            view_count  INTEGER,
            UNIQUE(title, month)
        )
    """)
    conn.commit()
    conn.close()
    print("Database initialised.")


def get_npov_articles(limit=200): #200 because some articles might not be viewable, buffer
    """Fetch articles tagged with NPOV dispute template."""
    print("Fetching NPOV-tagged articles...")
    url = "https://en.wikipedia.org/w/api.php"
    articles = []
    params = {
    "action":      "query",        # what we want to do
    "list": "embeddedin", # which type of query
    "eititle": "Template:NPOV", # which category
    "eilimit": "500",          # max results per page
    "einamespace": "0",            # namespace 0 = main articles only (not talk pages etc)
    "format":      "json"          # return data as JSON
    }
    while len(articles) < limit:
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=10)#sends HTTP request, timeout means if no response after 10 seconds,stop
            data = r.json()#parses text into python dict since r is raw text
#wiki returns something like this
# {
#   "query": {
#     "categorymembers": [
#       {"title": "Some Article"},
#       {"title": "Another Article"}
#     ]
#   }
# }
            print("STATUS:", r.status_code)
            print("RESPONSE:", r.text[:300])
            members = data.get("query", {}).get("embeddedin", [])#get(key,default)
            articles.extend([m["title"] for m in members])#store found articles in the variable
            # handle pagination
            if "continue" in data and len(articles) < limit: #wiki has limit of 500 results per request, if there are more, it includes a "continue" key. so we want to know if the continue key exists or if we havent reached our predetermined limit
                params["cmcontinue"] = data["continue"]["cmcontinue"]
            else:
                break
        except Exception as e:
            print(f"Error fetching NPOV articles: {e}")
            break
        time.sleep(0.5)  #let wiki api rest a bit.
    print("Sample NPOV articles:", articles[:5])
    print(f"  Found {len(articles)} NPOV articles.")
    return articles

def get_random_articles(limit=200):
    """Fetch random non-NPOV articles."""
    print("Fetching random articles...")
    url = "https://en.wikipedia.org/w/api.php"
    articles = []
    while len(articles) < limit:
        params = {
            "action":      "query",
            "list":        "random",
            "rnlimit":     "50",
            "rnnamespace": "0",
            "format":      "json"
        }#random wiki api is limited to 50 per call, so we loop till we get 100 or more if needed
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=10)
            data = r.json()
            pages = data.get("query", {}).get("random", [])
            articles.extend([p["title"] for p in pages])
        except Exception as e:
            print(f"Error fetching random articles: {e}")
            break
        time.sleep(0.5)

    print(f"  Found {len(articles)} random articles.")
    return articles

def get_monthly_views(title, start=START_MONTH, end=END_MONTH):
    """Fetch monthly view counts for a single article."""
    safe_title = title.replace(" ", "_")
    url = (
        f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
        f"en.wikipedia/all-access/all-agents/{requests.utils.quote(safe_title, safe='')}"
        f"/monthly/{start}/{end}"
    )
#https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Some_Article/monthly/2024010100/2026033000
#sample url output.
#no params needed since start and end date are directly embedded in the url
# that would break the url, this converts them to safe versions. for example Che Guevara & Castro becomes Che%20Guevara%20%26%20Castro
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            data = r.json()
            return data.get("items", [])
# {
#   "items": [
#     {"timestamp": "2024010100", "views": 1523},
#     {"timestamp": "2024020100", "views": 892},
#     {"timestamp": "2024030100", "views": 1104}
#   ]
# }
#wiki returns something like this as a string in r
        elif r.status_code == 404:
            return []  # article has no view data
        else:
            print(f"  HTTP {r.status_code} for {title}")
            return []
    except Exception as e:
        print(f"  Error fetching views for {title}: {e}")
        return []
# 200 — request succeeded
# 404 — not found, article doesn't exist or has no data
# 429 — too many requests
# 500 — server error


def save_article(title, is_npov):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO articles (title, is_npov, fetched_at) VALUES (?, ?, ?)",
           #try to insert, if it exists, skip 
            (title, int(is_npov), datetime.now().isoformat())
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"  DB error saving article {title}: {e}")
    finally:
        conn.close()

def save_views(title, view_items):
    conn = sqlite3.connect(DB_PATH)
    for item in view_items:
        try:
            conn.execute(
                "INSERT OR IGNORE INTO views (title, month, view_count) VALUES (?, ?, ?)",
                (title, item.get("timestamp", ""), item.get("views", 0))
            )
        except sqlite3.Error as e:
            print(f"  DB error saving views for {title}: {e}")
    conn.commit()
    conn.close()


def print_summary():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row #allows u to use column names instead of index

    total = conn.execute("SELECT COUNT(*) as c FROM articles").fetchone()["c"]
    npov  = conn.execute("SELECT COUNT(*) as c FROM articles WHERE is_npov=1").fetchone()["c"]
    non   = conn.execute("SELECT COUNT(*) as c FROM articles WHERE is_npov=0").fetchone()["c"]
    views = conn.execute("SELECT COUNT(*) as c FROM views").fetchone()["c"]

    avg_npov = conn.execute("""
        SELECT AVG(v.view_count) as avg
        FROM views v
        JOIN articles a ON v.title = a.title
        WHERE a.is_npov = 1
    """).fetchone()["avg"] #returns matching rows as a list

    avg_non = conn.execute("""
        SELECT AVG(v.view_count) as avg
        FROM views v
        JOIN articles a ON v.title = a.title
        WHERE a.is_npov = 0
    """).fetchone()["avg"]

    conn.close()

    print("\n" + "="*50)
    print("STUDY SUMMARY")
    print("="*50)
    print(f"total articles:        {total}")
    print(f"  NPOV tagged:         {npov}")
    print(f"  Non-tagged:          {non}")
    print(f"total view records:    {views}")
    print(f"avg monthly views (NPOV):     {avg_npov:.0f}" if avg_npov else "Avg monthly views (NPOV): N/A")
    print(f"avg monthly views (non-NPOV): {avg_non:.0f}" if avg_non else "Avg monthly views (non-NPOV): N/A")
    print("="*50)


def main():
    init_db()

#random.sample(list, n) — picks n random items from a list without replacement
    npov_all = get_npov_articles(limit=300)
    npov_sample = random.sample(npov_all, min(SAMPLE_SIZE, len(npov_all)))
    print(f"Sampled {len(npov_sample)} NPOV articles.")


    random_all = get_random_articles(limit=300)#again, limit is buffer
    random_filtered = [a for a in random_all if a not in npov_all]
    random_sample = random.sample(random_filtered, min(SAMPLE_SIZE, len(random_filtered)))
    print(f"Sampled {len(random_sample)} non-tagged articles.")

    print("\nfetching views for npov articles")
    for i, title in enumerate(npov_sample):
        print(f"  [{i+1}/{len(npov_sample)}] {title}")
        save_article(title, is_npov=True)
        views = get_monthly_views(title)
        save_views(title, views)
        time.sleep(0.3)  # rate limiting again

    print("\nfetching views for non-tagged articles")
    for i, title in enumerate(random_sample):
        print(f"  [{i+1}/{len(random_sample)}] {title}")
        save_article(title, is_npov=False)
        views = get_monthly_views(title)
        save_views(title, views)
        time.sleep(0.3)

    print_summary()
    print(f"\nData saved to {DB_PATH}")
#You can open wiki_study.db with db Browser for sqlite to explore the data

if __name__ == "__main__":
    main()