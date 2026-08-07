import json

actual_map = {
    "user1": {
        "2026-08-07": "4.0",
        "2026-08-08": "4.0",
        "2026-08-09": "0.0",
        "__extra__": "2"
    },
    "user2": {
        "2026-08-05": "2",
        "2026-08-06": "8"
    }
}

dates_with_hours = set()
for day_map in actual_map.values():
    if isinstance(day_map, dict):
        for d, h in day_map.items():
            if d != '__extra__':
                try:
                    if float(h or 0) > 0:
                        dates_with_hours.add(d)
                except (ValueError, TypeError):
                    pass

if dates_with_hours:
    first_date = min(dates_with_hours)
    last_date = max(dates_with_hours)
    print(first_date, last_date)
