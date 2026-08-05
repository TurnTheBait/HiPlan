import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    original_content = content

    if 'ProjectDetailPage.jsx' in filepath:
        content = content.replace("<span>{change.before.start_date} → {change.before.end_date}</span>",
                                  "<span>{formatDateOnly(change.before.start_date)} → {formatDateOnly(change.before.end_date)}</span>")
        content = content.replace("<span>{change.after.start_date} → {change.after.end_date}</span>",
                                  "<span>{formatDateOnly(change.after.start_date)} → {formatDateOnly(change.after.end_date)}</span>")
        content = re.sub(r'Inizio: \$\{new Date\(project\.start_date\)\.toLocaleDateString\(\)\}', 
                         r'Inizio: ${formatDateOnly(project.start_date)}', content)
        content = re.sub(r'Fine: \$\{new Date\(project\.end_date\)\.toLocaleDateString\(\)\}', 
                         r'Fine: ${formatDateOnly(project.end_date)}', content)

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

process_file('/Users/davidegirolamo/Programming/Gantt/frontend/src/pages/ProjectDetailPage.jsx')

