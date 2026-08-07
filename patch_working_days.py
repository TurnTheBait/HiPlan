import re

with open('frontend/src/pages/ProjectDetailPage.jsx', 'r') as f:
    content = f.read()

# Replace addWorkingDays(prev.start_date || new Date(), days)
content = content.replace("addWorkingDays(prev.start_date || new Date(), days)", "addWorkingDays(prev.start_date || new Date(), days, prev.excluded_dates)")
content = content.replace("addWorkingDays(newStart, days)", "addWorkingDays(newStart, days, prev.excluded_dates)")
content = content.replace("addWorkingDays(sDate, days)", "addWorkingDays(sDate, days, taskForm.excluded_dates)")
content = content.replace("addWorkingDays(sDate, newDays)", "addWorkingDays(sDate, newDays, task.excluded_dates ? JSON.parse(task.excluded_dates) : [])")

# Replace countWorkingDays
content = content.replace("countWorkingDays(s, e)", "countWorkingDays(s, e, realTask.excluded_dates)")
content = content.replace("countWorkingDays(prev.start_date, prev.end_date)", "countWorkingDays(prev.start_date, prev.end_date, prev.excluded_dates)")
content = content.replace("countWorkingDays(newStart, prev.end_date)", "countWorkingDays(newStart, prev.end_date, prev.excluded_dates)")
content = content.replace("countWorkingDays(prev.start_date, newEnd)", "countWorkingDays(prev.start_date, newEnd, prev.excluded_dates)")
content = content.replace("countWorkingDays(sDate, eDate)", "countWorkingDays(sDate, eDate, taskForm.excluded_dates)")
content = content.replace("countWorkingDays(sDateForBudget, eDateForBudget)", "countWorkingDays(sDateForBudget, eDateForBudget, taskForm.excluded_dates)")

# Replace subtractWorkingDays
content = content.replace("subtractWorkingDays(prev.end_date || new Date(), days)", "subtractWorkingDays(prev.end_date || new Date(), days, prev.excluded_dates)")
content = content.replace("subtractWorkingDays(newEnd, days)", "subtractWorkingDays(newEnd, days, prev.excluded_dates)")

with open('frontend/src/pages/ProjectDetailPage.jsx', 'w') as f:
    f.write(content)
