"""Utility functions for Italian working days calculations."""
from datetime import date, timedelta


def get_easter(year: int) -> date:
    """Calculate Easter date for a given year (Gregorian calendar)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day_of_month = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day_of_month)


def is_italian_holiday(d: date) -> bool:
    """Return True if d is an Italian public holiday or weekend."""
    if d.weekday() >= 5:  # Saturday=5, Sunday=6
        return True
    fixed = {
        (1, 1), (1, 6), (4, 25), (5, 1), (6, 2),
        (8, 15), (11, 1), (12, 8), (12, 25), (12, 26),
    }
    if (d.month, d.day) in fixed:
        return True
    easter = get_easter(d.year)
    pasquetta = easter + timedelta(days=1)
    if d == pasquetta:
        return True
    return False


def is_working_day(d: date) -> bool:
    return not is_italian_holiday(d)


def count_working_days_in_range(start: date, end: date) -> int:
    """Count working days from start to end inclusive."""
    count = 0
    cur = start
    while cur <= end:
        if is_working_day(cur):
            count += 1
        cur += timedelta(days=1)
    return count


def get_working_days_in_range(start: date, end: date) -> list:
    """Return list of working day dates from start to end inclusive."""
    days = []
    cur = start
    while cur <= end:
        if is_working_day(cur):
            days.append(cur)
        cur += timedelta(days=1)
    return days
