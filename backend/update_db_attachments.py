import sqlite3

db_path = "ganttflow.db"

def migrate():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Add attachments to projects
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN attachments TEXT DEFAULT '[]'")
        print("Added attachments column to projects table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("attachments column already exists in projects table.")
        else:
            raise e

    # Add attachments to notes
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN attachments TEXT DEFAULT '[]'")
        print("Added attachments column to notes table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("attachments column already exists in notes table.")
        else:
            raise e
            
    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate()
