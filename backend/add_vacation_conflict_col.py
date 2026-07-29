import sqlite3
try:
    conn = sqlite3.connect('backend/ganttflow.db')
    c = conn.cursor()
    c.execute('ALTER TABLE tasks ADD COLUMN has_vacation_conflict BOOLEAN DEFAULT 0')
    conn.commit()
    conn.close()
    print("Column added successfully")
except Exception as e:
    print(f"Error: {e}")
