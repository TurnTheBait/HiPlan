from datetime import date

from app.services import task_service


def test_find_vacation_conflicts_for_dates_returns_workdays_overlap():
    vacations = [
        {"start_date": date(2026, 7, 20), "end_date": date(2026, 7, 24)}
    ]

    conflicts = task_service.find_vacation_conflicts(
        task_start=date(2026, 7, 21),
        task_end=date(2026, 7, 23),
        vacations=vacations,
    )

    assert len(conflicts) == 1
    assert conflicts[0]["workdays"] == 3
