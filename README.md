# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kapkopi/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kapkopi/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks pre-token protocols by what their launch would be worth. Each protocol's implied value comes from its own TVL priced at its category's market multiple, taken from the live-token protocols in the same category, then adjusted for seven-day growth, age with no token, and chain breadth. Every row carries a concrete farm plan with costs and times, and the board covers the whole watchlist plus every other rankable pre-token protocol in the snapshot.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
node serve.ts --dir out
```

Then open http://localhost:8080 in a browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref=n3ev77xf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
