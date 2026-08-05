import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    original_content = content

    if 'TicketsPage.jsx' in filepath:
        content = re.sub(r'month: \'short\'', r"month: '2-digit'", content)
    
    if 'NotesPage.jsx' in filepath:
        content = re.sub(r'month: \'short\'', r"month: '2-digit'", content)
        content = re.sub(r'year: \'numeric\'', r"year: 'numeric'", content)

    if 'DashboardPage.jsx' in filepath:
        content = re.sub(r'month: \'short\'', r"month: '2-digit'", content)
        content = re.sub(r'month: \'long\'', r"month: '2-digit'", content)

    if 'ProjectDetailPage.jsx' in filepath:
        # replace new Date().toLocaleDateString() which we missed 
        content = re.sub(r'new Date\((.*?)\)\.toLocaleDateString\(\)', r'formatDateOnly(\1)', content)

    if 'ConflictMonitoringPage.jsx' in filepath:
        # already handled formatDate implementation, but in list of formats, it uses 'long' month
        content = re.sub(r"month: 'long'", r"month: '2-digit'", content)

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

for root, dirs, files in os.walk('/Users/davidegirolamo/Programming/Gantt/frontend/src/'):
    for file in files:
        if file.endswith('.jsx'):
            process_file(os.path.join(root, file))

