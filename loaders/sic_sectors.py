"""
sic_sectors.py
--------------
Approximate mapping of SEC SIC codes (4-digit industry codes) to the
11 market sectors used in the project dashboard. This is a heuristic —
GICS codes would be more precise but aren't available from the SEC.
"""

def sector_for_sic(sic: int | None) -> str | None:
    if sic is None:
        return None
    s = int(sic)
    if 1000 <= s <= 1499 or 2600 <= s <= 2699 or 2800 <= s <= 2829 \
            or 2860 <= s <= 2899 or 3200 <= s <= 3499:
        return "Materials"
    if 1300 <= s <= 1389 or 2900 <= s <= 2999 or 4600 <= s <= 4699 \
            or 4922 <= s <= 4924:
        return "Energy"
    if 1500 <= s <= 1799 or 3400 <= s <= 3569 or 3580 <= s <= 3599 \
            or 3700 <= s <= 3709 or 3720 <= s <= 3799 \
            or 4000 <= s <= 4599 or 4700 <= s <= 4799 \
            or 3800 <= s <= 3829 or 8700 <= s <= 8748:
        return "Industrials"
    if 3570 <= s <= 3579 or 3600 <= s <= 3699 or 7370 <= s <= 7379 \
            or 5045 <= s <= 5045 or 3860 <= s <= 3869:
        return "Technology"
    if 4800 <= s <= 4899 or 2700 <= s <= 2799 or 7800 <= s <= 7849:
        return "Communication Services"
    if 2000 <= s <= 2199 or 2840 <= s <= 2844 or 5140 <= s <= 5149 \
            or 5410 <= s <= 5499:
        return "Consumer Staples"
    if 2200 <= s <= 2599 or 3000 <= s <= 3069 or 3710 <= s <= 3716 \
            or 3900 <= s <= 3999 or 5000 <= s <= 5044 \
            or 5046 <= s <= 5139 or 5150 <= s <= 5399 \
            or 5500 <= s <= 5999 or 7000 <= s <= 7299 \
            or 7500 <= s <= 7699 or 7850 <= s <= 7999:
        return "Consumer Discretionary"
    if 2830 <= s <= 2836 or 3840 <= s <= 3851 or 8000 <= s <= 8099 \
            or 5912 <= s <= 5912 or 5122 <= s <= 5122:
        return "Healthcare"
    if 6000 <= s <= 6299 or 6310 <= s <= 6499 or 6700 <= s <= 6799:
        return "Financials"
    if 4900 <= s <= 4999:
        return "Utilities"
    if 6500 <= s <= 6599 or 6798 <= s <= 6798:
        return "Real Estate"
    return "Other"
