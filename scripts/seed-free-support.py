"""Generate idempotent D1 seed SQL for reviewed support links and ADI referrals."""

import argparse
import csv
import re
import sys
from html import unescape
from pathlib import Path

ADI_PAGE = "https://www.alzint.org/our-members/member-associations/"
MEMBER_CARD = re.compile(
    r'<h3 class="item-header-title">\s*'
    r'<a href="(https://www\.alzint\.org/member/([a-z0-9-]+)/)">([^<]+)</a>'
    r'\s*</h3>\s*<h4 class="item-header-subtitle">([^<]+)</h4>'
)
COUNTRIES = {
    "AU": "Australia", "CA": "Canada", "GB": "United Kingdom",
    "IE": "Ireland", "NZ": "New Zealand", "US": "United States",
}
LABELS = {
    "caregiver-support": "Caregiver support",
    "financial-assistance": "Financial assistance",
    "helpline": "Helpline",
}


def curated_listings():
    catalog = Path(__file__).resolve().parents[1] / "data" / "free-support.psv"
    with catalog.open(encoding="utf-8", newline="") as source:
        for key, code, category, name, url, phone, description in csv.reader(
            source, delimiter="|"
        ):
            if not url.startswith("https://"):
                raise ValueError(f"Expected an HTTPS source for {key}")
            yield (
                "free-support-" + key, name, f"{LABELS[category]}. {description}",
                url, url, phone or None, COUNTRIES[code], code, category,
            )


def adi_listings(html):
    matches = MEMBER_CARD.findall(html)
    if len(matches) < 90 or len({slug for _, slug, _, _ in matches}) != len(matches):
        raise ValueError("ADI member cards changed or are incomplete. Review the source before importing.")
    aliases = {"USA": "United States", "UK": "United Kingdom"}
    codes = {name: code for code, name in COUNTRIES.items()}
    for url, slug, name, place in matches:
        name = unescape(name).strip()
        place = unescape(place).strip()
        place = aliases.get(place, place)
        yield (
            "adi-referral-" + slug, name,
            "Caregiver support. Find contact details for the local Alzheimer's or dementia "
            "association in the Alzheimer's Disease International directory. Ask about "
            "available services, eligibility and any charges.",
            url, ADI_PAGE, None, place, codes.get(place), "caregiver-support",
        )


def literal(value):
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("adi_html", type=Path, help="Saved HTML from the ADI member directory")
    args = parser.parse_args()
    listings = [*curated_listings(), *adi_listings(args.adi_html.read_text(encoding="utf-8"))]
    if len({row[0] for row in listings}) != len(listings):
        raise ValueError("Duplicate resource IDs")
    sys.stdout.reconfigure(encoding="utf-8")
    for row in listings:
        values = ", ".join(map(literal, row))
        print(f"""INSERT INTO resources (
  id, name, description, website_url, source_url, phone, country, country_code, category
) VALUES ({values}) ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, description = excluded.description, website_url = excluded.website_url,
  source_url = excluded.source_url, phone = excluded.phone, country = excluded.country,
  country_code = excluded.country_code, category = excluded.category,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');""")


if __name__ == "__main__":
    main()
