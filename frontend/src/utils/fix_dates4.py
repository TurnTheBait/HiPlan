import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    original_content = content

    if 'TimelineView.jsx' in filepath:
        content = re.sub(r'title=\{`\$\{proj\.name\} \(\$\{pStart\} -\> \$\{pEnd\}\)`\}',
                         r'title={`${proj.name} (${pStart.split("-").reverse().join("/")} -> ${pEnd.split("-").reverse().join("/")})`}', content)
        content = re.sub(r'title=\{`Ferie \(\$\{vStart\} -\> \$\{vEnd\}\)`\}',
                         r'title={`Ferie (${vStart.split("-").reverse().join("/")} -> ${vEnd.split("-").reverse().join("/")})`}', content)
        content = re.sub(r'title=\{`\$\{t\.name\} \(\$\{tStart\} -\> \$\{tEnd\}\)`\}',
                         r'title={`${t.name} (${tStart.split("-").reverse().join("/")} -> ${tEnd.split("-").reverse().join("/")})`}', content)

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

process_file('/Users/davidegirolamo/Programming/Gantt/frontend/src/components/calendar/TimelineView.jsx')

