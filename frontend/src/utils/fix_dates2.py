import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    original_content = content

    # ProjectDetailPage.jsx Specifics:
    if 'ProjectDetailPage.jsx' in filepath:
        content = content.replace("{project?.start_date || 'N/D'} → {project?.end_date || 'N/D'}",
                                  "{formatDateOnly(project?.start_date)} → {formatDateOnly(project?.end_date)}")
        content = content.replace("{t.start_date} → {t.end_date}",
                                  "{formatDateOnly(t.start_date)} → {formatDateOnly(t.end_date)}")
        content = content.replace("{t.start_date || 'N/D'} → {t.end_date || 'N/D'}",
                                  "{formatDateOnly(t.start_date)} → {formatDateOnly(t.end_date)}")
        # For 'Inizio/Fine: 2026-06-30 -> 2026-09-15'
        content = re.sub(r'\{t\.start_date( \|\| \'N/D\')?\} → \{t\.end_date( \|\| \'N/D\')?\}',
                         r'{formatDateOnly(t.start_date)} → {formatDateOnly(t.end_date)}', content)
        content = re.sub(r'\{t\.start_date\s*\?\s*t\.start_date\.slice\(0,\s*10\)\s*:\s*\'\'\}',
                         r'{formatDateOnly(t.start_date)}', content)
        content = re.sub(r'\{t\.end_date\s*\?\s*t\.end_date\.slice\(0,\s*10\)\s*:\s*\'\'\}',
                         r'{formatDateOnly(t.end_date)}', content)
                         
    if 'GanttChart.jsx' in filepath:
        pass # covered

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

for root, dirs, files in os.walk('/Users/davidegirolamo/Programming/Gantt/frontend/src/'):
    for file in files:
        if file.endswith('.jsx'):
            process_file(os.path.join(root, file))

