from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from fastapi import HTTPException, status


async def register_user(db: AsyncSession, data: UserCreate) -> User:
    clean_email = data.email.strip().lower()
    clean_username = data.username.strip()
    
    existing = await db.execute(
        select(User).where((func.lower(User.email) == clean_email) | (func.lower(User.username) == clean_username.lower()))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email o username già registrati")

    # Se è il primo utente o ha username 'admin', assegna ruolo ADMIN
    count_result = await db.execute(select(User.id))
    first_user = count_result.first() is None
    assigned_role = UserRole.ADMIN if (first_user or clean_username.lower() == "admin") else UserRole.VIEWER

    # Determina il reparto: admin sempre 'admin', altrimenti quello scelto (default null)
    assigned_department = "admin" if assigned_role == UserRole.ADMIN else (data.department or None)

    user = User(
        email=clean_email,
        username=clean_username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        role=assigned_role,
        department=assigned_department,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    login_str = email.strip()
    result = await db.execute(
        select(User).where(
            (func.lower(User.email) == login_str.lower()) | (func.lower(User.username) == login_str.lower())
        )
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali non valide")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disattivato")
    return user


def generate_tokens(user: User) -> dict:
    token_data = {"sub": user.id, "role": user.role.value}
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
    }


async def refresh_access_token(db: AsyncSession, refresh_token: str) -> dict:
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token non valido")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utente non trovato")

    return generate_tokens(user)
