import enum
# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String, Text, Enum, ForeignKey, Float, Boolean, DateTime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class RichiestaStatus(str, enum.Enum):
    APERTA = "aperta"
    IN_LAVORAZIONE = "in_lavorazione"
    MANCA_LISTINO = "manca_listino"
    COMPLETATA = "completata"


class TipoFornitura(str, enum.Enum):
    MATERIE_PRIME = "materie_prime"
    MP_LAVORAZIONE = "mp_lavorazione"
    COMPRAVENDITA = "compravendita"


class RichiestaCommerciale(Base, TimestampMixin):
    __tablename__ = "richieste_commerciali"

    id = uuid_pk()
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    description_originale = Column(Text, nullable=True)  # Snapshot descrizione originale (visibile diff solo admin)
    numero_offerta = Column(String(100), nullable=True)
    cliente = Column(String(255), nullable=False)
    attachments = Column(Text, default="[]", nullable=False)  # JSON list of file paths
    deleted_at = Column(DateTime, nullable=True, default=None)

    author_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    articoli_inserted_by_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    articoli_inserted_at = Column(DateTime(timezone=True), nullable=True)
    listino_inserted_by_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    listino_inserted_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(
        Enum(RichiestaStatus),
        default=RichiestaStatus.APERTA,
        nullable=False,
        index=True,
    )

    # Relazioni
    author = relationship("User", foreign_keys=[author_id])
    articoli_inserted_by = relationship("User", foreign_keys=[articoli_inserted_by_id])
    listino_inserted_by = relationship("User", foreign_keys=[listino_inserted_by_id])
    articoli = relationship(
        "ArticoloRichiesta",
        back_populates="richiesta",
        cascade="all, delete-orphan",
        order_by="ArticoloRichiesta.created_at",
    )


class ArticoloRichiesta(Base, TimestampMixin):
    __tablename__ = "articoli_richiesta"

    id = uuid_pk()
    richiesta_id = Column(
        uuid_fk(), ForeignKey("richieste_commerciali.id", ondelete="CASCADE"), nullable=False
    )

    # Campi compilati dall'acquisti
    titolo = Column(String(255), nullable=False)
    costo = Column(Float, nullable=False)
    descrizione = Column(Text, nullable=True)

    # Spunte tipologia prodotto
    is_standard = Column(Boolean, default=False, nullable=False)
    is_atex = Column(Boolean, default=False, nullable=False)
    is_alimentare = Column(Boolean, default=False, nullable=False)

    # Tipo fornitura
    tipo_fornitura = Column(
        Enum(TipoFornitura),
        default=None,
        nullable=True,
    )

    attachments = Column(Text, default="[]", nullable=False)  # JSON list

    # Campi compilati dall'admin nella fase finale
    prezzo_listino = Column(Float, nullable=True)

    # Snapshot testo originale acquisti (per diff evidenziazione in fase admin)
    # JSON: {"titolo": "...", "descrizione": "...", "note_acquisti": "..."}
    testo_originale_acquisti = Column(Text, nullable=True)

    # Note aggiuntive admin
    note_admin = Column(Text, nullable=True)

    author_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relazioni
    richiesta = relationship("RichiestaCommerciale", back_populates="articoli")
    author = relationship("User", foreign_keys=[author_id])
