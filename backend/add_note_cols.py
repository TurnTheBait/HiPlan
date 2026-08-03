import sqlite3

def add_columns():
    conn = sqlite3.connect('ganttflow.db')
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN visibility VARCHAR(50) DEFAULT 'private'")
        print("Aggiunta colonna visibility")
    except sqlite3.OperationalError as e:
        print(f"Colonna visibility forse già esiste: {e}")
        
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN shared_with TEXT DEFAULT '[]'")
        print("Aggiunta colonna shared_with")
    except sqlite3.OperationalError as e:
        print(f"Colonna shared_with forse già esiste: {e}")
        
    # Update existing shared notes to team
    cursor.execute("UPDATE notes SET visibility = 'team' WHERE is_shared = 1 AND visibility = 'private'")
    conn.commit()
    conn.close()

if __name__ == "__main__":
    add_columns()
