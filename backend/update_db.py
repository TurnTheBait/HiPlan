import sqlite3

def add_columns():
    conn = sqlite3.connect('ganttflow.db')
    cursor = conn.cursor()
    
    # Try adding notify_sent
    try:
        cursor.execute("ALTER TABLE todos ADD COLUMN notify_sent BOOLEAN DEFAULT 0 NOT NULL;")
        print("Aggiunta colonna notify_sent")
    except sqlite3.OperationalError as e:
        print(f"Colonna notify_sent forse già esiste: {e}")
        
    # Try adding due_reminder_sent
    try:
        cursor.execute("ALTER TABLE todos ADD COLUMN due_reminder_sent BOOLEAN DEFAULT 0 NOT NULL;")
        print("Aggiunta colonna due_reminder_sent")
    except sqlite3.OperationalError as e:
        print(f"Colonna due_reminder_sent forse già esiste: {e}")
        
    conn.commit()
    conn.close()

if __name__ == "__main__":
    add_columns()
