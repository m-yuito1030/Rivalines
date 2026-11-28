# Security and multi-user test scripts

Run against a **local** server only (never the live site). Needs the `ws` package (already in node_modules).

```
# Terminal 1: default limits (for the brute-force checks)      Terminal 2: relaxed limits (many accounts from one address)
PORT=8101 DATA_DIR=/tmp/d1 WORLD_SIZE=4096 ADMIN_KEY=test npx tsx server/index.ts
PORT=8102 DATA_DIR=/tmp/d2 WORLD_SIZE=4096 ADMIN_KEY=test AUTH_RATE=100000 REGISTER_PER_HOUR=100000 npx tsx server/index.ts

cd tools/securitytest
BASE=http://localhost:8101 BASE2=http://localhost:8102 node sec.js   # attack checks (auth, admin, frames, authorization, money, fuzz of every command)
BASE2=http://localhost:8102 N=110 node mp.js                       # N users at once (builds, budgets, a race for one tile, cross-company attempts, load)
BASE2=http://localhost:8102 node fz.js                             # which commands throw inside the server (should print nothing)
```
