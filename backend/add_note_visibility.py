import sqlite3

def add_col():
    conn = sqlite3.connect('ganttflow.db')
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN visibility TEXT DEFAULT 'private' NOT NULL;")
        print("Aggiunta colonna visibility")
    except sqlite3.OperationalError as e:
        print(f"Colonna visibility forse già esiste: {e}")
        
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN shared_with TEXT DEFAULT '[]' NOT NULL;")
        print("Aggiunta colonna shared_with")
    except sqlite3.OperationalError as e:
        print(f"Colonna shared_with forse già esiste: {e}")
        
    # Migrate existing data
    cursor.execute("UPDATE notes SET visibility = 'team' WHERE is_shared = 1;")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    add_col()
