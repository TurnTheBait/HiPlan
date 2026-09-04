import React, { useState, useMemo, useEffect } from 'react';
import AppIcon from './AppIcon';
import './MultiDatePicker.css';

export default function MultiDatePicker({
  startDate,
  allVacations = [],
  workers = [],
  excludedDates = [],
  onChange
}) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (startDate) {
      return new Date(startDate);
    }
    return new Date();
  });

  // Extract all vacation dates for selected workers
  const workerVacationDates = useMemo(() => {
    const dates = new Set();
    if (!workers || workers.length === 0) return dates;
    
    const wVacations = allVacations.filter(v => workers.includes(v.username));
    wVacations.forEach(v => {
      let current = new Date(v.start_date);
      const vEnd = new Date(v.end_date);
      while (current <= vEnd) {
        if (current.getDay() !== 0 && current.getDay() !== 6) {
          dates.add(current.toISOString().split('T')[0]);
        }
        current.setDate(current.getDate() + 1);
      }
    });
    return dates;
  }, [allVacations, workers]);

  // Merge vacation dates into excludedDates initially
  useEffect(() => {
    if (workers.length > 0) {
      const newExclusions = new Set(excludedDates);
      let changed = false;
      workerVacationDates.forEach(d => {
        if (!newExclusions.has(d)) {
          newExclusions.add(d);
          changed = true;
        }
      });
      if (changed) {
        onChange(Array.from(newExclusions));
      }
    }
  }, [workerVacationDates, workers]);

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };
  
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  // Adjust so Monday is 0, Sunday is 6
  const startingDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const toggleDate = (dateStr) => {
    const newExclusions = new Set(excludedDates);
    if (newExclusions.has(dateStr)) {
      newExclusions.delete(dateStr);
    } else {
      newExclusions.add(dateStr);
    }
    onChange(Array.from(newExclusions));
  };

  const renderDays = () => {
    const days = [];
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');

    // Empty cells before start of month
    for (let i = 0; i < startingDay; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, '0');
      const dateStr = `${year}-${month}-${dayStr}`;
      const dateObj = new Date(year, currentMonth.getMonth(), d);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      const isExcluded = excludedDates.includes(dateStr);
      const isVacation = workerVacationDates.has(dateStr);

      let className = "calendar-day";
      if (isWeekend) className += " weekend";
      else if (isExcluded) className += " excluded";
      else if (isVacation) className += " vacation"; // should not happen if auto-merged, but just in case

      days.push(
        <div 
          key={dateStr} 
          className={className} 
          onClick={() => !isWeekend && toggleDate(dateStr)}
          title={isVacation ? "Ferie programmate per uno degli addetti" : ""}
        >
          {d}
          {isExcluded && <div className="check-mark">✓</div>}
        </div>
      );
    }
    return days;
  };

  const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

  return (
    <div className="multi-date-picker">
      <div className="calendar-header">
        <button type="button" onClick={prevMonth} className="btn-icon" aria-label="Mese precedente"><AppIcon name="chevronLeft" size={16}/></button>
        <strong>{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</strong>
        <button type="button" onClick={nextMonth} className="btn-icon" aria-label="Mese successivo"><AppIcon name="chevronRight" size={16}/></button>
      </div>
      <div className="calendar-grid">
        <div className="weekday">Lun</div>
        <div className="weekday">Mar</div>
        <div className="weekday">Mer</div>
        <div className="weekday">Gio</div>
        <div className="weekday">Ven</div>
        <div className="weekday weekend">Sab</div>
        <div className="weekday weekend">Dom</div>
        {renderDays()}
      </div>
      <div className="calendar-legend">
        <div className="legend-item"><span className="dot excluded">✓</span> Giorni saltati (ferie)</div>
      </div>
    </div>
  );
}
