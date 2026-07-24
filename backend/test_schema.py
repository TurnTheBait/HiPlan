from app.schemas.ticket import TicketOut

data = {
    "id": "123",
    "title": "test",
    "author_id": "456",
    "status": "open",
    "priority": "medium",
    "attachments": [{"name": "file.jpg", "path": "uploads/..."}]
}

try:
    ticket = TicketOut(**data)
    print(ticket)
except Exception as e:
    print(e)
