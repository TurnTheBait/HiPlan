export function calculateTaskEffHours(task) {
  if (!task || !task.actual_hours || typeof task.actual_hours !== 'object') return 0;
  let tot = 0;
  Object.values(task.actual_hours).forEach(dayMap => {
    if (dayMap && typeof dayMap === 'object') {
      Object.values(dayMap).forEach(h => {
        tot += Number(h) || 0;
      });
    }
  });
  return tot;
}

export function isTaskCompleted(task) {
  if (!task) return false;
  if (Number(task.completed) === -1) return false;
  if (Number(task.completed) === 1) return true;
  if (Number(task.progress) >= 1) return true;
  const plannedH = Number(task.planned_hours || 8);
  if (plannedH > 0) {
    const effH = calculateTaskEffHours(task);
    if (effH >= plannedH) return true;
  }
  return false;
}
