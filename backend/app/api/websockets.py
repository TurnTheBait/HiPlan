# pyrefly: ignore [missing-import]
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from app.core.websocket_manager import manager
from app.models.user import User
router = APIRouter(prefix="/api/ws", tags=["WebSockets"])

@router.websocket("/projects/{project_id}")
async def websocket_project_endpoint(
    websocket: WebSocket,
    project_id: str
):
    """
    Endpoint WebSocket per la collaborazione real-time sui progetti.
    Per motivi di semplicità dell'autenticazione tramite WS (i browser non mandano gli header Auth),
    qui si può optare per un token in query_string o saltare il controllo rigoroso se si è in una rete fidata.
    """
    await manager.connect(websocket, project_id)
    try:
        while True:
            # Attendiamo eventuali messaggi in ingresso dal client (es. ping/pong o messaggi utente)
            data = await websocket.receive_text()
            # Al momento non gestiamo l'input dal client, il server "pusherà" solo i dati
    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)
