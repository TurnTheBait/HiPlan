// Calcolo dinamico della Pasquetta (Lunedì dell'Angelo) per qualsiasi anno
export function getPasquettaDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const pasqua = new Date(year, month, day);
  return new Date(pasqua.getTime() + 86400000);
}

// Verifica se una data (Date object o stringa YYYY-MM-DD) è un fine settimana (Sabato/Domenica) o una Festività Nazionale Italiana
export function isWeekendOrHoliday(date) {
  if (!date) return false;
  let dObj = date;
  if (typeof date === 'string') {
    const cleanStr = date.split(' ')[0].split('T')[0];
    dObj = new Date(cleanStr + 'T00:00:00');
  }
  if (!dObj || !(dObj instanceof Date) || isNaN(dObj)) return false;

  const dayOfWeek = dObj.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true; // Sabato (6) o Domenica (0)

  const d = dObj.getDate();
  const m = dObj.getMonth(); // 0-11
  const y = dObj.getFullYear();

  // Festività Nazionali Italiane fisse
  if (
    (d === 1 && m === 0) ||   // 1 Gennaio - Capodanno
    (d === 6 && m === 0) ||   // 6 Gennaio - Epifania
    (d === 25 && m === 3) ||  // 25 Aprile - Festa della Liberazione
    (d === 1 && m === 4) ||   // 1 Maggio - Festa dei Lavoratori
    (d === 2 && m === 5) ||   // 2 Giugno - Festa della Repubblica
    (d === 15 && m === 7) ||  // 15 Agosto - Ferragosto
    (d === 1 && m === 10) ||  // 1 Novembre - Tutti i Santi
    (d === 8 && m === 11) ||  // 8 Dicembre - Immacolata Concezione
    (d === 25 && m === 11) || // 25 Dicembre - Natale
    (d === 26 && m === 11)    // 26 Dicembre - Santo Stefano
  ) {
    return true;
  }

  // Pasquetta (mobile)
  const pasquetta = getPasquettaDate(y);
  if (d === pasquetta.getDate() && m === pasquetta.getMonth()) {
    return true;
  }

  return false;
}

// Controlla se una data (Date o stringa YYYY-MM-DD) è un effettivo giorno lavorativo (esclusi sab, dom e festivi)
export function isWorkingDay(d) {
  return !isWeekendOrHoliday(d);
}

// Aggiunge N giorni lavorativi a partire da startDate (esclude sabato, domenica e festivi)
export function addWorkingDays(startDate, workingDays) {
  if (!startDate) return '';
  const start = typeof startDate === 'string' ? new Date(startDate.split(' ')[0].split('T')[0] + 'T00:00:00') : new Date(startDate);
  if (isNaN(start)) return '';

  const totalDays = Math.max(1, Number(workingDays) || 1);
  let cur = new Date(start);

  // Se il giorno iniziale non è lavorativo, avanza fino al primo giorno lavorativo
  while (!isWorkingDay(cur)) {
    cur.setDate(cur.getDate() + 1);
  }

  let daysCounted = 1;
  while (daysCounted < totalDays) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur)) {
      daysCounted++;
    }
  }

  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const day = String(cur.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sottrae N giorni lavorativi a ritroso a partire da endDate (esclude sabato, domenica e festivi)
export function subtractWorkingDays(endDate, workingDays) {
  if (!endDate) return '';
  const end = typeof endDate === 'string' ? new Date(endDate.split(' ')[0].split('T')[0] + 'T00:00:00') : new Date(endDate);
  if (isNaN(end)) return '';

  const totalDays = Math.max(1, Number(workingDays) || 1);
  let cur = new Date(end);

  // Se il giorno finale non è lavorativo, torna indietro fino al primo giorno lavorativo
  while (!isWorkingDay(cur)) {
    cur.setDate(cur.getDate() - 1);
  }

  let daysCounted = 1;
  while (daysCounted < totalDays) {
    cur.setDate(cur.getDate() - 1);
    if (isWorkingDay(cur)) {
      daysCounted++;
    }
  }

  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const day = String(cur.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Conta i giorni lavorativi (esclusi sab, dom e festivi) tra startDate e endDate incluse
export function countWorkingDays(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 1;
  const start = typeof startDateStr === 'string' ? new Date(startDateStr.split(' ')[0].split('T')[0] + 'T00:00:00') : new Date(startDateStr);
  const end = typeof endDateStr === 'string' ? new Date(endDateStr.split(' ')[0].split('T')[0] + 'T00:00:00') : new Date(endDateStr);
  if (isNaN(start) || isNaN(end)) return 1;
  if (start > end) return 1;

  let count = 0;
  let cur = new Date(start);
  while (cur <= end) {
    if (isWorkingDay(cur)) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}
