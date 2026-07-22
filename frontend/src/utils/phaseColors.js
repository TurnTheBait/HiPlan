export const PREDEFINED_PHASES = [
  'Layout - Invio al cliente per approvazione',
  'Approvazione cliente',
  'Utenze elettriche',
  'Calcolo strutturale',
  'Progettazione esecutiva - Messa in tavola - Codifica - Distinta base',
  'Targhette',
  'Documentazione tecnica (Manuali)',
  'Certificati',
  'Certificati - Approvazione Responsabile',
  'Compilazione modulo check list',
  'Inserimento costi in Higest',
  '__custom__', // Personalizzata
];

export const PHASE_DEFAULT_COLORS = {
  'Layout - Invio al cliente per approvazione': '#3b82f6', // Blue
  'Approvazione cliente': '#10b981',                       // Emerald Green
  'Utenze elettriche': '#f59e0b',                          // Amber / Yellow
  'Calcolo strutturale': '#84cc16',                        // Lime
  'Progettazione esecutiva - Messa in tavola - Codifica - Distinta base': '#8b5cf6', // Violet / Purple
  'Targhette': '#ec4899',                                  // Pink
  'Documentazione tecnica (Manuali)': '#d97706',           // Warm Gold / Orange
  'Certificati': '#06b6d4',                                // Cyan
  'Certificati - Approvazione Responsabile': '#f43f5e',    // Rose / Red
  'Compilazione modulo check list': '#e11d48',             // Ruby Red
  'Inserimento costi in Higest': '#fb7185',                // Soft Rose / Peach
};

export const PRIORITY_FALLBACK_COLORS = {
  low: '#10b981',
  medium: '#3b82f6',
  high: '#f59e0b',
  critical: '#ef4444',
};

export function getTaskColor(task) {
  if (!task) return '#3b82f6';
  const name = task.text || task.faseSel;
  // Se la fase ha un colore predefinito diverso dal verde completato, preferisci quello se il colore attuale è nullo o verde completato
  if (name && PHASE_DEFAULT_COLORS[name] && name !== 'Approvazione cliente') {
    if (!task.color || task.color === '#10b981') {
      return PHASE_DEFAULT_COLORS[name];
    }
  }
  if (task.color && typeof task.color === 'string' && task.color.trim() !== '') {
    return task.color;
  }
  if (name && PHASE_DEFAULT_COLORS[name]) {
    return PHASE_DEFAULT_COLORS[name];
  }
  return PRIORITY_FALLBACK_COLORS[task.priority || 'medium'] || '#3b82f6';
}
