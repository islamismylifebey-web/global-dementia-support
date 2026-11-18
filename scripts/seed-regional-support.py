"""Build D1 upserts from official Medicaid, SHIP and 211 Canada directory snapshots."""

import argparse
import re
import sys
from html import unescape
from pathlib import Path

MEDICAID = "https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip"
SHIP = "https://www.shiphelp.org/"
CANADA_211 = "https://211.ca/211-service-providers/"


def medicaid(html):
    table = re.search(r"STATE MEDICAID LINKS.*?</table>", html, re.DOTALL)
    if not table:
        raise ValueError("Missing Medicaid state contact table")
    contacts = re.findall(r'<h3 id="([A-Z]{2,3})">([^<]+)</h3>', table[0])
    if len(contacts) < 51:
        raise ValueError("Incomplete Medicaid state contact table")
    for code, name in contacts:
        region = unescape(name).strip()
        url = f"{MEDICAID}#{code}"
        yield (
            f"medicaid-contact-{code.lower()}", f"{region} Medicaid contacts",
            "Financial assistance. Find local Medicaid application, eligibility and contact "
            "information. Ask the agency about coverage for long-term services and supports.",
            url, url, None, "United States", "US", region, "financial-assistance",
        )


def ship(html):
    nav = re.search(r'<ul class="ships-nav">(.*?)</ul>', html, re.DOTALL)
    if not nav:
        raise ValueError("Missing SHIP locator")
    states = re.findall(r'<a href="https://www\.shiphelp\.org/ships/([a-z-]+)/">([^<]+)</a>', nav[1])
    if len(states) < 51:
        raise ValueError("Incomplete SHIP locator")
    for slug, name in states:
        region = unescape(name).strip()
        yield (
            f"ship-referral-{slug}", f"{region} SHIP Medicare counseling",
            "Financial assistance. Get free, one-on-one Medicare counseling about coverage "
            "and ways to lower costs. Use the official SHIP profile to contact a local counselor.",
            f"{SHIP}ships/{slug}/", SHIP, None, "United States", "US", region, "financial-assistance",
        )


def canada_211(html):
    regions = re.findall(
        r'<h2>[^<]+<a [^>]*href="(https?://[^"]+)"[^>]*>Visit ([^<]+) 211</a></h2>',
        html,
    )
    if len(regions) != 13:
        raise ValueError("Expected one 211 referral for each Canadian province and territory")
    for url, name in regions:
        region = unescape(name).strip().replace(" & ", " and ")
        slug = re.sub(r"[^a-z]+", "-", region.lower()).strip("-")
        yield (
            f"ca-211-referral-{slug}", f"211 {region} community referrals",
            "Helpline. Free referrals to local community and government assistance such as food, "
            "housing and caregiver services. Check the listing for local ways to reach 211.",
            unescape(url).replace("http://", "https://", 1), CANADA_211, "211", "Canada", "CA", region, "helpline",
        )


def literal(value):
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("medicaid_html", type=Path)
    parser.add_argument("ship_html", type=Path)
    parser.add_argument("canada_211_html", type=Path)
    args = parser.parse_args()
    listings = [
        *medicaid(args.medicaid_html.read_text(encoding="utf-8")),
        *ship(args.ship_html.read_text(encoding="utf-8")),
        *canada_211(args.canada_211_html.read_text(encoding="utf-8")),
    ]
    if len({row[0] for row in listings}) != len(listings):
        raise ValueError("Duplicate regional listing IDs")

    sys.stdout.reconfigure(encoding="utf-8")
    for row in listings:
        values = ", ".join(map(literal, row))
        print(f"""INSERT INTO resources (
  id, name, description, website_url, source_url, phone, country, country_code, region, category
) VALUES ({values}) ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, description = excluded.description, website_url = excluded.website_url,
  source_url = excluded.source_url, phone = excluded.phone, region = excluded.region,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');""")


if __name__ == "__main__":
    main()
