import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original_content = content
    
    # Replace internal formatDate in TodoPage.jsx
    if 'function formatDate(dateStr)' in content and 'TodoPage.jsx' in filepath:
        content = re.sub(r'function formatDate\(dateStr\) \{[\s\S]*?\}',
                         r'function formatDate(dateStr) {\n  if (!dateStr) return "";\n  const d = new Date(dateStr);\n  if (isNaN(d.getTime())) return dateStr;\n  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;\n}',
                         content)

    # Replace internal formatDate in ConflictMonitoringPage.jsx
    if 'function formatDate(isoString)' in content and 'ConflictMonitoringPage.jsx' in filepath:
        content = re.sub(r'function formatDate\(isoString\) \{[\s\S]*?\}',
                         r'function formatDate(isoString) {\n  if (!isoString) return "";\n  const d = new Date(isoString);\n  if (isNaN(d.getTime())) return isoString;\n  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;\n}',
                         content)
                         
    # Replace formatDateOnly in ProjectDetailPage.jsx
    if 'function formatDateOnly(d)' in content and 'ProjectDetailPage.jsx' in filepath:
        content = re.sub(r'function formatDateOnly\(d\) \{[\s\S]*?\}',
                         r'function formatDateOnly(d) {\n  if (!d) return "N/D";\n  const date = new Date(d);\n  if (isNaN(date.getTime())) return d;\n  return `${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}/${date.getFullYear()}`;\n}',
                         content)

    # Change simple render of `project.start_date -> project.end_date` in various places
    # e.g., {selectedProject.start_date || 'N/D'} ➔ {selectedProject.end_date || 'N/D'}
    # Better to use a regex for common patterns in GanttChart.jsx, CalendarPage.jsx, ProfilePage.jsx
    
    # ProfilePage.jsx:
    # {v.start_date} → {v.end_date}
    if 'ProfilePage.jsx' in filepath:
        content = content.replace('{v.start_date} → {v.end_date}', 
                                  '{v.start_date ? v.start_date.split("-").reverse().join("/") : ""} → {v.end_date ? v.end_date.split("-").reverse().join("/") : ""}')
                                  
    # CalendarPage.jsx
    if 'CalendarPage.jsx' in filepath:
        # {selectedProject.start_date || 'N/D'} ➔ {selectedProject.end_date || 'N/D'}
        content = re.sub(r'\{selectedProject\.start_date \|\| \'N/D\'\}', 
                         r'{selectedProject.start_date ? selectedProject.start_date.substring(0,10).split("-").reverse().join("/") : \'N/D\'}', content)
        content = re.sub(r'\{selectedProject\.end_date \|\| \'N/D\'\}', 
                         r'{selectedProject.end_date ? selectedProject.end_date.substring(0,10).split("-").reverse().join("/") : \'N/D\'}', content)
                         
        content = re.sub(r'\{t\.start_date\?\.slice\(0, 10\)\}',
                         r'{t.start_date ? t.start_date.slice(0, 10).split("-").reverse().join("/") : ""}', content)
        content = re.sub(r'\{t\.end_date\?\.slice\(0, 10\) \|\| \'N/D\'\}',
                         r'{t.end_date ? t.end_date.slice(0, 10).split("-").reverse().join("/") : \'N/D\'}', content)
                         
    # ProjectDetailPage.jsx: uses formatDateOnly extensively. We replaced it above, but we also have:
    # `inizio / fine` texts or similar. Let's check where .substring(0, 10) is rendered.
    content = re.sub(r'\{(.*?)\.substring\(0,\s*10\)\}', r'{\1.substring(0, 10).split("-").reverse().join("/")}', content)
    content = re.sub(r'\{(.*?)\.slice\(0,\s*10\)\}', r'{\1.slice(0, 10).split("-").reverse().join("/")}', content)
    
    # In GanttChart.jsx:
    if 'GanttChart.jsx' in filepath:
        content = content.replace('Inizio: ${task.start_date.substring(0, 10)}', 'Inizio: ${task.start_date.substring(0, 10).split("-").reverse().join("/")}')
        content = content.replace('Fine: ${task.end_date.substring(0, 10)}', 'Fine: ${task.end_date.substring(0, 10).split("-").reverse().join("/")}')
        content = content.replace('{project.start_date.substring(0, 10)}', '{project.start_date.substring(0, 10).split("-").reverse().join("/")}')
        content = content.replace('{project.end_date.substring(0, 10)}', '{project.end_date.substring(0, 10).split("-").reverse().join("/")}')

    # In WorkloadHeatmap.jsx:
    if 'WorkloadHeatmap.jsx' in filepath:
        if 'const formatDateStr = (key) => {' in content:
            content = re.sub(r'const formatDateStr = \(key\) => \{[\s\S]*?\}',
                             r'const formatDateStr = (key) => { const [y,m,d] = key.split("-"); return `${d}/${m}/${y}`; }',
                             content)

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

for root, dirs, files in os.walk('/Users/davidegirolamo/Programming/Gantt/frontend/src/'):
    for file in files:
        if file.endswith('.jsx'):
            process_file(os.path.join(root, file))

