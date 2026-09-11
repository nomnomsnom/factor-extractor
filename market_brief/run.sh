#!/bin/sh
# Fetch, build, validate. Publishing is a separate, deliberate step: the news
# and gaps prose has to be rewritten by hand before anything is written to the
# artifact database. See README.md.
set -eu
cd "$(dirname "$0")"

python3 fetch_yahoo.py '%5EGSPC' '%5EIXIC' '%5EDJI' '%5ERUT' '%5EVIX' \
                       'BZ%3DF' 'CL%3DF' '%5EN225' '%5EHSI' '%5ESTI' '%5ETNX' \
                       NVDA AMD MU INTC AAPL META GOOGL AMZN MRVL TSM AVGO
python3 fetch_fred.py DGS10 DGS2 DGS20
python3 build.py
python3 validate.py
