from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.dependencies import get_db
from app.schemas.user import UserCreate, UserLogin, UserOut, TokenPair, TokenRefresh
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)):
    user = await auth_service.register_user(db, data)
    return user


@router.post("/login", response_model=TokenPair)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await auth_service.authenticate_user(db, data.email, data.password)
    return auth_service.generate_tokens(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: TokenRefresh, db: AsyncSession = Depends(get_db)):
    return await auth_service.refresh_access_token(db, data.refresh_token)
