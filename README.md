# Solar Dashboard

A self-hosted dashboard for a Fronius inverter with a Fronius smart meter, built so anyone in the house can glance at an iPad and see whether the washing machine or dryer can run on spare solar right now.

- **Now screen:** one big card per appliance. Green means _Go now_, amber means _Okay_, red means _Wait_. Below the cards: what the panels are making, what the house is using, and today's chart with peak times shaded.
- **History:** peak grid power, solar generated, solar used and solar value by day, week, month and year, compared with the same dates last year.
- **Settings:** PIN-protected appliance thresholds, electricity rates, Solcast forecast, and Solar.web history import.

## How the cards decide

A card's colour answers one question: **how much of this cycle would run on peak-rate grid power?** Off-peak grid power is fine, so only the part of a cycle that falls in peak time has to be covered by spare solar.

| Card            | Meaning                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Green, _Go now_ | No peak-rate power needed. Either it's off-peak for the whole cycle, or spare solar covers the peak part.        |
| Amber, _Okay_   | A little peak power, usually because solar is fading or only partly covers it. The card shows an estimated cost. |
| Red, _Wait_     | Mostly peak power. The card says when it gets better ("Off-peak from 9pm", "Sunny from 11am tomorrow").          |
| Grey, _No data_ | No inverter reading for 2 minutes. The cards never show an old green.                                            |

The model uses:

- **Spare solar now:** the 5-minute average of solar production minus house use, trusted for the first 10 minutes of a cycle.
- **Solcast forecast after that:** solar production minus the house's typical load at that time of day (the median of the last 14 days). If live output differs from the forecast, the forecast is scaled to match, and that correction fades out over about 90 minutes.
- **Peak times:** TasNetworks Tariff 93, weekdays 7–10am and 4–9pm **AEST**. These fall an hour later on the clock during daylight saving. Weekends are off-peak.

Each appliance has a **green threshold** (spare kW needed, including headroom), a **typical draw** (used for cost estimates) and a **cycle length**. All three are adjustable in Settings.

### Known limitation: one circuit

The Fronius meter only measures the house's general circuit. Heating and hot water are on a separate circuit it can't see. Both run only off-peak (the hot water starts when the morning peak ends), so at peak the Fronius meter sees the whole house. This was checked against a bill: peak import 91.7 kWh measured vs 97.6 kWh billed. Off-peak usage and "solar used at home" are understated, and there's deliberately no estimated bill.

## Data sources

| Source                              | Used for                     | Notes                                                                                                                      |
| ----------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Fronius Solar API (`/solar_api/v1`) | Live readings every 5 s      | Plain HTTP on the LAN, no login                                                                                            |
| Fronius archive (`GetArchiveData`)  | 5-minute history             | About 9 months are held on the inverter. Backfilled on first start (slow: about a week per minute), then re-synced hourly. |
| Solcast rooftop site                | Forecast                     | Free hobbyist tier. About 9 calls a day, spaced through daylight.                                                          |
| Solar.web "Energy balance" export   | Older history (daily totals) | Import in Settings. Peak/off-peak split is estimated from similar months and marked "≈".                                   |

## Running on Unraid

1. Add the container from `unraid-template.xml`, or use `docker-compose.yml`. Map `/config` to appdata and pick a host port (default 8420).
2. Open `http://<unraid-ip>:8420`, go to **Settings** (default PIN **0000**, change it), and enter your Solcast site ID and API key.
3. In Settings, import Solar.web **Energy balance** exports (daily values, one year per file) for history older than the inverter's archive.
4. On the iPad, open the page in Safari, then **Share → Add to Home Screen**. It opens full screen with its own icon.

### Environment variables

| Variable                                 | Default                         |                                            |
| ---------------------------------------- | ------------------------------- | ------------------------------------------ |
| `INVERTER_HOST`                          | –                               | Overrides the inverter address in Settings |
| `SOLCAST_API_KEY`, `SOLCAST_RESOURCE_ID` | –                               | Override the Solcast settings              |
| `SETTINGS_PIN`                           | –                               | Overrides the PIN                          |
| `DATA_DIR`                               | `/config`                       | Where `config.json` and `solar.db` live    |
| `PORT`                                   | `8080`                          | Port inside the container                  |
| `TZ`, `PUID`, `PGID`                     | `Australia/Hobart`, `99`, `100` | Unraid conventions                         |

**Behind a reverse proxy** (for example the Cloudflare tunnel), put an auth layer such as Pocket-ID in front of it, because the dashboard itself has no login. The settings PIN only guards against accidental changes.

`/api/live` returns the current snapshot as JSON, which Home Assistant can read with a REST sensor.

## Development

```bash
npm install
npm run dev
```

The dev server polls the real inverter and keeps its data in `./data`. `npm test` runs the unit tests, covering the card rules, peak times across daylight saving, costing against a real bill, the archive parser, the Solar.web importer and the history maths. `npm run check` type-checks the project.
