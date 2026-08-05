filepath = '/Users/davidegirolamo/Programming/Gantt/frontend/src/pages/TodoPage.jsx'
with open(filepath, 'r') as f:
    content = f.read()

content = content.replace("}).replace(',', '');\n  }", "}")
with open(filepath, 'w') as f:
    f.write(content)
print('Fixed TodoPage.jsx')

