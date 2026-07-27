import json
import logging
from typing import Dict, List, Any
# pyrefly: ignore [missing-import]
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Mappa project_id -> lista di WebSocket connessi
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: str):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)
        logger.info(f"WebSocket client connected to project {project_id}. Total: {len(self.active_connections[project_id])}")

    def disconnect(self, websocket: WebSocket, project_id: str):
        if project_id in self.active_connections:
            if websocket in self.active_connections[project_id]:
                self.active_connections[project_id].remove(websocket)
            if not self.active_connections[project_id]:
                del self.active_connections[project_id]
        logger.info(f"WebSocket client disconnected from project {project_id}.")

    async def broadcast(self, project_id: str, message: dict):
        """
        Invia un messaggio a tutti i client connessi a un certo project_id.
        """
        if project_id in self.active_connections:
            text_data = json.dumps(message)
            dead_connections = []
            for connection in self.active_connections[project_id]:
                try:
                    await connection.send_text(text_data)
                except Exception as e:
                    logger.error(f"Errore durante l'invio del messaggio WebSocket: {e}")
                    dead_connections.append(connection)
            
            # Pulisce le connessioni "morte" (disconnesse in modo sporco)
            for dead in dead_connections:
                self.disconnect(dead, project_id)

manager = ConnectionManager()
