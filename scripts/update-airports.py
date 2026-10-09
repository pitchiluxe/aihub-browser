"""Refresh the bundled public-domain OurAirports directory. No runtime API key needed."""
import csv
import io
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE = 'https://ourairports.com/data/airports.csv'
request = urllib.request.Request(SOURCE, headers={'User-Agent': 'AIHub-Browser airport-directory-updater'})
with urllib.request.urlopen(request, timeout=60) as response:
    rows = csv.DictReader(io.StringIO(response.read().decode('utf-8-sig')))
    airports = {}
    for row in rows:
        iata = row['iata_code'].strip().upper()
        if not re.fullmatch(r'[A-Z]{3}', iata) or row['type'] not in ('large_airport', 'medium_airport', 'small_airport', 'seaplane_base'):
            continue
        icao = row.get('icao_code', '').strip().upper()
        record = [iata, icao, row['name'], row['municipality'], row['iso_country'], row['scheduled_service'] == 'yes']
        if iata not in airports or (record[-1] and not airports[iata][-1]):
            airports[iata] = record
data = {'source': SOURCE, 'license': 'Public domain', 'updated': datetime.now(timezone.utc).isoformat(), 'airports': sorted(airports.values())}
target = Path(__file__).resolve().parents[1] / 'src/renderer/src/components/travel/airports.json'
target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Bundled {len(airports)} airports ({target.stat().st_size:,} bytes).')
