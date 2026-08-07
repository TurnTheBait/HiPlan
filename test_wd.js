function isWeekendOrHoliday(d) { return d.getDay() === 0 || d.getDay() === 6; }
function isWorkingDay(d, excludedDates = []) {
  if (isWeekendOrHoliday(d)) return false;
  if (!excludedDates || excludedDates.length === 0) return true;
  let dObj = d;
  if (typeof d === 'string') {
    dObj = new Date(d.split(' ')[0].split('T')[0] + 'T00:00:00');
  }
  const y = dObj.getFullYear();
  const m = String(dObj.getMonth() + 1).padStart(2, '0');
  const day = String(dObj.getDate()).padStart(2, '0');
  const dStr = `${y}-${m}-${day}`;
  return !excludedDates.includes(dStr);
}
function addWorkingDays(startDate, workingDays, excludedDates = []) {
  const start = new Date(startDate + 'T00:00:00');
  const totalDays = Math.max(1, Number(workingDays) || 1);
  let cur = new Date(start);
  while (!isWorkingDay(cur, excludedDates)) {
    cur.setDate(cur.getDate() + 1);
  }
  let daysCounted = 1;
  while (daysCounted < totalDays) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur, excludedDates)) {
      daysCounted++;
    }
  }
  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const d = String(cur.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
console.log(addWorkingDays("2026-08-17", 4, ["2026-08-17", "2026-08-18"]));
