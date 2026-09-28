# Solar Dashboard

A self-hosted dashboard for a Fronius inverter with a Fronius smart meter, built so anyone in the house can glance at an iPad and see whether the washing machine or dryer can run on spare solar right now.

- **Now screen:** one big card per appliance. Green means _Go now_, amber means _Okay_, red means _Wait_. Below the cards: what the panels are making, what the house is using, and today's chart with peak times shaded.
- **History:** peak grid power, solar generated, solar used and solar value by day, week, month and year, compared with the same dates last year.
- **Settings:** PIN-protected appliance thresholds, electricity rates, forecast source (ChargeHA or Solcast), and Solar.web history import.

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
- **Solar forecast after that** (from ChargeHA, or Solcast directly): solar production minus the house's typical load at that time of day (the median of the last 14 days). If live output differs from the forecast, the forecast is scaled to match, and that correction fades out over about 90 minutes.
- **Car charging:** when [ChargeHA](https://github.com/dubberness/ChargeHA) is charging the car in auto mode on solar only, it turns the car down within about 30 seconds of something else switching on, so that charging counts as spare. In solar + grid mode only the part above the minimum amps counts; Charge Now, charge schedules and charging ChargeHA isn't controlling count as house use. The car is also left out of the typical-load figure and the dashboard's "Using" number. ChargeHA's power figure is the amps it asked for, which the car may not take, so the dashboard reads the car's measured current and voltage from Tessie if you give it a token. Without Tessie it uses ChargeHA's figure, capped by what the meter sees.
- **Peak times:** TasNetworks Tariff 93, weekdays 7–10am and 4–9pm **AEST**. These fall an hour later on the clock during daylight saving. Weekends are off-peak.

Each appliance has a **green threshold** (spare kW needed, including headroom), a **typical draw** (used for cost estimates) and a **cycle length**. All three are adjustable in Settings.

### Known limitation: one circuit

The Fronius meter only measures the house's general circuit. Heating and hot water are on a separate circuit it can't see. Both run only off-peak (the hot water starts when the morning peak ends), so at peak the Fronius meter sees the whole house. This was checked against a bill: peak import 91.7 kWh measured vs 97.6 kWh billed. Off-peak usage and "solar used at home" are understated, and there's deliberately no estimated bill.

## Data sources

| Source                                    | Used for                     | Notes                                                                                                                               |
| ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fronius Solar API (`/solar_api/v1`)       | Live readings every 5 s      | Plain HTTP on the LAN, no login                                                                                                     |
| Fronius archive (`GetArchiveData`)        | 5-minute history             | About 9 months are held on the inverter. Backfilled on first start (slow: about a week per minute), then re-synced hourly.          |
| ChargeHA `forecast.summary` (recommended) | Forecast                     | ChargeHA already fetches Solcast; reading its forecast costs no extra Solcast calls. Refreshed every 15 min.                        |
| ChargeHA `charger.list` etc. (every 20 s) | Car charging mode            | Whether the car is charging, and whether ChargeHA would turn it down for the house. Read-only tRPC queries, no login needed.        |
| Tessie `/vehicles` (optional)             | Car charging power           | The car's measured current × voltage. Only asked while the car is charging. Served from Tessie's cache, so it doesn't wake the car. |
| Solcast rooftop site (fallback)           | Forecast                     | Only if you don't run ChargeHA. Free hobbyist tier: about 9 calls a day, spaced through daylight.                                   |
| Solar.web "Energy balance" export         | Older history (daily totals) | Import in Settings. Peak/off-peak split is estimated from similar months and marked "≈".                                            |

## Running on Unraid

1. Add the container from `unraid-template.xml`, or use `docker-compose.yml`. Map `/config` to appdata and pick a host port (default 8420).
2. Open `http://<unraid-ip>:8420`, go to **Settings** (default PIN **0000**, change it), and check the forecast source. The default is ChargeHA: set its address (for example `http://192.168.1.3:8000`) there or with `CHARGEHA_URL`.

   Optionally paste a Tessie API token (Tessie → Settings → API) so the car's charging power is measured rather than estimated.

   **Solcast's free tier allows about 10 calls a day per account.** If ChargeHA already uses your Solcast account, keep this dashboard on the ChargeHA source so the two don't share that budget. Keep the ChargeHA container set to auto-start, since the dashboard falls back to live readings when ChargeHA is down.

3. In Settings, import Solar.web **Energy balance** exports (daily values, one year per file) for history older than the inverter's archive.
4. On the iPad, open the page in Safari, then **Share → Add to Home Screen**. It opens full screen with its own icon.

### Environment variables

| Variable                                 | Default                         |                                            |
| ---------------------------------------- | ------------------------------- | ------------------------------------------ |
| `INVERTER_HOST`                          | –                               | Overrides the inverter address in Settings |
| `CHARGEHA_URL`                           | –                               | ChargeHA address (forecast and car)        |
| `SOLCAST_API_KEY`, `SOLCAST_RESOURCE_ID` | –                               | Direct Solcast (only without ChargeHA)     |
| `TESSIE_TOKEN`                           | –                               | Measured car charging power (optional)     |
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
