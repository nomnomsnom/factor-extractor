"""
Wikipedia NPOV Dispute Study
Compares mean monthly view counts (Sept 2025 - Feb 2026) of NPOV-tagged vs non-tagged articles.
Runs a Welch two-sample t-test on mean monthly views per article.
Only articles with actual view data in the 6-month window are counted.
"""
from scipy.stats import t
import requests
import sqlite3
import time
import random
from datetime import datetime
import json
import math
import os

#parameters
TARGET_N    = 200          # articles per category
START_MONTH = "2025090100" # September 2025 YYYYMMDDHR btw
END_MONTH   = "2026020100" # February 2026
DB_PATH     = "wiki_study.db"
HEADERS     = {"User-Agent": "WikiStudy/1.0 (research project; contact@example.com)"} #wiki requests some info
#ProjectName/Version (description; contact) wiki format


def init_db():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Old database {DB_PATH} removed.")
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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS article_means (
            id                 INTEGER PRIMARY KEY,
            title              TEXT UNIQUE,
            is_npov            INTEGER,
            mean_monthly_views REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS summary (
            id          INTEGER PRIMARY KEY,
            group_type  TEXT,
            avg_views   REAL,
            computed_at TEXT
        )
    """)
    conn.commit()
    conn.close()
    print("Database initialised.")


def get_npov_articles_batch(params):
    url = "https://en.wikipedia.org/w/api.php"
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=10) #sends HTTP request, timeout means if no response after 10 seconds, stop
        data = r.json() #parses text into python dict since r is raw text
        members = data.get("query", {}).get("embeddedin", []) #get(key,default)
        titles = [m["title"] for m in members]
        continuation = data.get("continue", {}).get("eicontinue", None)
        return titles, continuation
    except Exception as e:
        print(f"  Error fetching NPOV batch: {e}")
        return [], None


def get_npov_articles(target=TARGET_N * 3): #buffer
    print("Fetching NPOV-tagged articles...")
    articles = []
    params = {
        "action":      "query",        # what we want to do
        "list":        "embeddedin",   # which type of query
        "eititle": "Template:POV", # which template
        "eilimit":     "500",          # max results per page
        "einamespace": "0",            # namespace 0 = main articles only (not talk pages etc)
        "format":      "json"          # return data as JSON
    }
    while len(articles) < target:
        titles, continuation = get_npov_articles_batch(params)
        articles.extend(titles)
        if continuation and len(articles) < target: #wiki has limit of 500 results per request, if there are more, it includes a "continue" key
            params["eicontinue"] = continuation
        else:
            break
        time.sleep(0.5) #let wiki api rest a bit
    random.shuffle(articles)
    print(f"  Found {len(articles)} NPOV articles.")
    return articles


def get_random_articles_batch():
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action":      "query",
        "list":        "random",
        "rnlimit":     "50", #random wiki api is limited to 50 per call, so we loop till we get enough
        "rnnamespace": "0",
        "format":      "json"
    }
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=10)
        data = r.json()
        pages = data.get("query", {}).get("random", [])
        return [p["title"] for p in pages]
    except Exception as e:
        print(f"Error fetching random batch: {e}")
        return []


def get_monthly_views(title, start=START_MONTH, end=END_MONTH):
    safe_title = title.replace(" ", "_")
    url = (
        f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
        f"en.wikipedia/all-access/all-agents/{requests.utils.quote(safe_title, safe='')}"
        f"/monthly/{start}/{end}"
    )
    #https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Some_Article/monthly/2025090100/2026020100
    #sample url output. no params needed since start and end date are directly embedded in the url
    # requests.utils.quote converts special characters so they don't break the url. for example Che Guevara & Castro becomes Che%20Guevara%20%26%20Castro
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        # 200 — request succeeded
        # 404 — not found, article doesn't exist or has no data
        # 429 — too many requests
        # 500 — server error
        if r.status_code == 200:
            data = r.json()
            return data.get("items", [])
# {
#   "items": [
#     {"timestamp": "2025090100", "views": 1523},
#     {"timestamp": "2025100100", "views": 892},
#   ]
# }
        elif r.status_code == 404:
            return []  # article has no view data
        else:
            print(f"  HTTP {r.status_code} for {title}")
            return []
    except Exception as e:
        print(f"  Error fetching views for {title}: {e}")
        return []


def save_article(conn, title, is_npov):
    try:
        conn.execute(
            "INSERT OR IGNORE INTO articles (title, is_npov, fetched_at) VALUES (?, ?, ?)",
            #try to insert, if it exists, skip
            (title, int(is_npov), datetime.now().isoformat())
        )
    except sqlite3.Error as e:
        print(f"  DB error saving article {title}: {e}")


def save_views(conn, title, view_items):
    for item in view_items:
        try:
            conn.execute(
                "INSERT OR IGNORE INTO views (title, month, view_count) VALUES (?, ?, ?)",
                (title, item.get("timestamp", ""), item.get("views", 0))
            )
        except sqlite3.Error as e:
            print(f"  DB error saving views for {title}: {e}")


def save_mean(conn, title, is_npov, view_items):
    if not view_items:
        return
    total_views = sum(item.get("views", 0) for item in view_items)
    mean_views = total_views / len(view_items)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO article_means (title, is_npov, mean_monthly_views) VALUES (?, ?, ?)",
            (title, int(is_npov), mean_views)
        )
    except sqlite3.Error as e:
        print(f"  DB error saving mean for {title}: {e}")


def collect_articles(candidate_pool, is_npov, npov_titles_set=None):
    group_label = "NPOV" if is_npov else "non-tagged"
    print(f"\nCollecting {TARGET_N} usable {group_label} articles...")
    usable = []
    conn = sqlite3.connect(DB_PATH)
    for title in candidate_pool:
        if len(usable) >= TARGET_N:
            break
        if npov_titles_set and title in npov_titles_set:
            continue
        views = get_monthly_views(title)
        if not views:
            continue  # skip articles with no view data in the window
        save_article(conn, title, is_npov)
        save_views(conn, title, views)
        save_mean(conn, title, is_npov, views)
        conn.commit()
        usable.append(title)
        print(f"  [{len(usable)}/{TARGET_N}] {title} ({len(views)} months of data)")
        time.sleep(0.3)  # rate limiting
    conn.close()
    print(f"  Collected {len(usable)} usable {group_label} articles.")
    return usable


def compute_t_test(output_file="t_test_results.json"):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row #allows u to use column names instead of index

    npov_rows = conn.execute(
        "SELECT mean_monthly_views FROM article_means WHERE is_npov = 1"
    ).fetchall()
    non_rows = conn.execute(
        "SELECT mean_monthly_views FROM article_means WHERE is_npov = 0"
    ).fetchall()
    conn.close()

    npov = [row["mean_monthly_views"] for row in npov_rows]
    non  = [row["mean_monthly_views"] for row in non_rows]

    n1, n2 = len(npov), len(non)

    if n1 < 2 or n2 < 2:
        print("Not enough data for t-test.")
        return

    # compute sample means
    mean1 = sum(npov) / n1
    mean2 = sum(non)  / n2

    # compute sample variances
    var1 = sum((x - mean1) ** 2 for x in npov) / (n1 - 1)
    var2 = sum((x - mean2) ** 2 for x in non)  / (n2 - 1)

    # Welch's t-test
    t_stat = (mean1 - mean2) / math.sqrt(var1/n1 + var2/n2)

    # degrees of freedom (Welch-Satterthwaite)
    df = (var1/n1 + var2/n2) ** 2 / (
        ((var1/n1) ** 2) / (n1 - 1) +
        ((var2/n2) ** 2) / (n2 - 1)
    )

    # exact p-value using scipy
    p_value = 2 * (1 - t.cdf(abs(t_stat), df))

    results = {
        "test":                        "Welch two-sample t-test",
        "view_period":                 f"{START_MONTH} to {END_MONTH}",
        "n_npov":                      n1,
        "n_non_npov":                  n2,
        "mean_monthly_views_npov":     mean1,
        "mean_monthly_views_non_npov": mean2,
        "variance_npov":               var1,
        "variance_non_npov":           var2,
        "t_statistic":                 t_stat,
        "degrees_of_freedom":          df,
        "p_value":                     p_value,
        "significant_at_0.05": bool(p_value < 0.05)
    }

    with open(output_file, "w") as f:
        json.dump(results, f, indent=4)

    print(f"T-test results saved to {output_file}")
    print(f"  n (NPOV):           {n1}")
    print(f"  n (non-NPOV):       {n2}")
    print(f"  mean NPOV:          {mean1:.1f} views/month")
    print(f"  mean non-NPOV:      {mean2:.1f} views/month")
    print(f"  t-statistic:        {t_stat:.4f}")
    print(f"  degrees of freedom: {df:.1f}")
    print(f"  p-value:            {p_value:.4f}")
    print(f"  significant:        {p_value < 0.05}")


def print_summary():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row #allows u to use column names instead of index

    total = conn.execute("SELECT COUNT(*) as c FROM articles").fetchone()["c"]
    npov  = conn.execute("SELECT COUNT(*) as c FROM articles WHERE is_npov=1").fetchone()["c"]
    non   = conn.execute("SELECT COUNT(*) as c FROM articles WHERE is_npov=0").fetchone()["c"]
    views = conn.execute("SELECT COUNT(*) as c FROM views").fetchone()["c"]
    means = conn.execute("SELECT COUNT(*) as c FROM article_means").fetchone()["c"]

    avg_npov = conn.execute("""
        SELECT AVG(mean_monthly_views) as avg
        FROM article_means WHERE is_npov = 1
    """).fetchone()["avg"]

    avg_non = conn.execute("""
        SELECT AVG(mean_monthly_views) as avg
        FROM article_means WHERE is_npov = 0
    """).fetchone()["avg"]

    conn.close()

    print("\n" + "="*50)
    print("STUDY SUMMARY")
    print("="*50)
    print(f"total articles:            {total}")
    print(f"  NPOV tagged:             {npov}")
    print(f"  Non-tagged:              {non}")
    print(f"total view records:        {views}")
    print(f"total article means saved: {means}")
    print(f"avg mean views (NPOV):     {avg_npov:.1f}" if avg_npov else "avg mean views (NPOV): N/A")
    print(f"avg mean views (non-NPOV): {avg_non:.1f}" if avg_non else "avg mean views (non-NPOV): N/A")
    print("="*50)


def main():
    init_db()

    npov_pool = get_npov_articles(target=TARGET_N * 3) #buffer
    npov_usable = collect_articles(npov_pool, is_npov=True)

    if len(npov_usable) < TARGET_N:
        print(f"Warning: only found {len(npov_usable)} usable NPOV articles.")

    npov_set = set(npov_pool) #set for fast lookup
    print("\nBuilding random article pool...")
    random_pool = []
    while len(random_pool) < TARGET_N * 3: #buffer
        batch = get_random_articles_batch()
        filtered = [a for a in batch if a not in npov_set]
        random_pool.extend(filtered)
        time.sleep(0.5)
        print(f"  Pool size: {len(random_pool)}")

    random.shuffle(random_pool)
    non_usable = collect_articles(random_pool, is_npov=False, npov_titles_set=npov_set)

    if len(non_usable) < TARGET_N:
        print(f"Warning: only found {len(non_usable)} usable non-tagged articles.")

    print_summary()
    compute_t_test()

    print(f"\nData saved to {DB_PATH}")
    #You can open wiki_study.db with db Browser for sqlite to explore the data

if __name__ == "__main__":
    main()
