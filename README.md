# Meridian Watch

A geopolitical situation monitor: a 3D globe of world hotspots with risk dossiers, a commodities watchlist, chokepoint oil flows, a sanctions tracker, conflict timelines, and live air and sea traffic.

- **Live aircraft**: the aircraft feeds refuse requests made directly from web pages, so a GitHub Actions workflow (`.github/workflows/pages.yml`) fetches a snapshot server-side every 10 minutes from [adsb.lol](https://adsb.lol) (falling back to [airplanes.live](https://airplanes.live)). It covers every hotspot, every chokepoint and the busiest air corridors, plus military aircraft worldwide, and publishes it as `aircraft.json` next to the page.
- **Vessels**: switch on by adding an [AISStream.io](https://aisstream.io) key as a repository secret named `AISSTREAM_KEY` (Settings → Secrets and variables → Actions). The workflow then streams for about a minute each run across the Gulf, Red Sea, Gulf of Aden, Eastern Mediterranean, Black Sea, Baltic, Taiwan Strait, Malacca, the Cape and Panama, and publishes `ships.json`.
- **Briefing data** (`data.json`: hotspots, news, markets, trade measures, timelines) is refreshed twice a day, at 7:30 AM and 6 PM Arizona time.

Risk scores are an analytical assessment of public reporting, not an official index. Prices are snapshots from public market reports and are not for trading.
