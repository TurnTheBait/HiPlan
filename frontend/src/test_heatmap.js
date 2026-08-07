const heatmapData = {
  "user1": {
    "workload": {
      "2026-08-06": { "hours": 8 },
      "2026-08-07": { "hours": 8 },
      "2026-08-10": { "hours": 8 }
    }
  }
};

const allWorkDates = new Set();
Object.values(heatmapData).forEach(u => {
  Object.keys(u.workload || {}).forEach(d => allWorkDates.add(d));
  Object.keys(u.actual_workload || {}).forEach(d => allWorkDates.add(d));
});

let minDateStr = null;
let maxDateStr = null;
if (allWorkDates.size > 0) {
  const sorted = Array.from(allWorkDates).sort();
  minDateStr = sorted[0];
  maxDateStr = sorted[sorted.length - 1];
}

const today = new Date('2026-08-07T12:00:00Z');
if (!minDateStr || !maxDateStr) {
  minDateStr = today.toISOString().substring(0, 10);
  maxDateStr = today.toISOString().substring(0, 10);
}

const minDate = new Date(minDateStr);
const maxDate = new Date(maxDateStr);
const padPast = new Date(today.getTime() - 730 * 86400000);
const padFuture = new Date(today.getTime() + 1825 * 86400000);

if (padPast < minDate) minDateStr = padPast.toISOString().substring(0, 10);
if (padFuture > maxDate) maxDateStr = padFuture.toISOString().substring(0, 10);

const fullDatesSet = new Set(allWorkDates);
const start = new Date(minDateStr);
const end = new Date(maxDateStr);
const cur = new Date(start);

while (cur <= end) {
  fullDatesSet.add(cur.toISOString().substring(0, 10));
  cur.setDate(cur.getDate() + 1);
}

const sortedDates = Array.from(fullDatesSet).sort();
console.log("sortedDates contains 08-08:", sortedDates.includes('2026-08-08'));

const columnsMap = new Map();
sortedDates.forEach(dStr => {
  const d = new Date(dStr);
  let key = dStr;
  let label = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  if (!columnsMap.has(key)) columnsMap.set(key, label);
});

const columns = Array.from(columnsMap.keys()).sort();
console.log("columns contains 08-08:", columns.includes('2026-08-08'));
console.log("Index of 07-08:", columns.indexOf('2026-08-07'));
console.log("Index of 08-08:", columns.indexOf('2026-08-08'));
console.log("Index of 09-08:", columns.indexOf('2026-08-09'));
console.log("Index of 10-08:", columns.indexOf('2026-08-10'));
