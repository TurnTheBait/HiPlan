// Controlla se una data (Date o stringa YYYY-MM-DD) è un giorno lavorativo (Lunedì - Venerdì)
export function isWorkingDay(d) {
  if (!d) return false;
  const dateObj = typeof d === 'string' ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dateObj)) return false;
  const day = dateObj.getDay();
  return day !== 0 && day !== 6;
}

// Aggiunge N giorni lavorativi a partire da startDate (esclude sabato e domenica)
export function addWorkingDays(startDate, workingDays) {
  if (!startDate) return '';
  const start = typeof startDate === 'string' ? new Date(startDate + 'T00:00:00') : new Date(startDate);
  if (isNaN(start)) return '';
  
  const totalDays = Math.max(1, Number(workingDays) || 1);
  let cur = new Date(start);
  
  if (cur.getDay() === 6) {
    cur.setDate(cur.getDate() + 2);
  } else if (cur.getDay() === 0) {
    cur.setDate(cur.getDate() + 1);
  }
  
  let daysCounted = 1;
  while (daysCounted < totalDays) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) {
      daysCounted++;
    }
  }
  
  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const d = String(cur.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Sottrae N giorni lavorativi a ritroso a partire da endDate (esclude sabato e domenica)
export function subtractWorkingDays(endDate, workingDays) {
  if (!endDate) return '';
  const end = typeof endDate === 'string' ? new Date(endDate + 'T00:00:00') : new Date(endDate);
  if (isNaN(end)) return '';
  
  const totalDays = Math.max(1, Number(workingDays) || 1);
  let cur = new Date(end);
  
  if (cur.getDay() === 0) {
    cur.setDate(cur.getDate() - 2);
  } else if (cur.getDay() === 6) {
    cur.setDate(cur.getDate() - 1);
  }
  
  let daysCounted = 1;
  while (daysCounted < totalDays) {
    cur.setDate(cur.getDate() - 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) {
      daysCounted++;
    }
  }
  
  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const d = String(cur.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Conta i giorni lavorativi (esclusi sab e dom) tra startDate e endDate incluse
export function countWorkingDays(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 1;
  const start = typeof startDateStr === 'string' ? new Date(startDateStr + 'T00:00:00') : new Date(startDateStr);
  const end = typeof endDateStr === 'string' ? new Date(endDateStr + 'T00:00:00') : new Date(endDateStr);
  if (isNaN(start) || isNaN(end)) return 1;
  if (start > end) return 1;
  
  let count = 0;
  let cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}
