import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    original_content = content

    if 'CalendarPage.jsx' in filepath:
        content = content.replace(r"\'N/D\'", "'N/D'")

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

for root, dirs, files in os.walk('/Users/davidegirolamo/Programming/Gantt/frontend/src/'):
    for file in files:
        if file.endswith('.jsx'):
            process_file(os.path.join(root, file))

