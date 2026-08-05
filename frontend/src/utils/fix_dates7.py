import os

filepath = '/Users/davidegirolamo/Programming/Gantt/frontend/src/pages/ProjectDetailPage.jsx'
with open(filepath, 'r') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if line.strip() == "} catch {":
        if i > 0 and 'formatDateOnly(d)' in ''.join(lines[max(0, i-5):i]):
            skip = True
            continue
    if skip:
        if line.strip() == "}":
            skip = False
            continue
        continue
    new_lines.append(line)

with open(filepath, 'w') as f:
    f.writelines(new_lines)
print('Fixed ProjectDetailPage.jsx')

