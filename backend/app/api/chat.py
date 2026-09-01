# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from app.services.chat_service import chat_service
from app.core.dependencies import get_current_user
from app.models.user import User

router = APIRouter()

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str

@router.post("/", response_model=ChatResponse)
async def ask_chatbot(
    request: ChatRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Invia un messaggio al chatbot e ricevi una risposta basata sui dati del DB.
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Il messaggio non può essere vuoto.")
        
    answer = await chat_service.get_response(request.message, current_user=current_user)
    return ChatResponse(response=answer)
