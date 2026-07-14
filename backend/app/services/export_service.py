import io
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task
from app.models.project import Project
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from openpyxl import Workbook


async def export_excel(db: AsyncSession, project_id: str) -> io.BytesIO:
    project = await db.execute(select(Project).where(Project.id == project_id))
    proj = project.scalar_one()

    tasks = await db.execute(
        select(Task).where(Task.project_id == project_id).order_by(Task.sort_order)
    )

    wb = Workbook()
    ws = wb.active
    ws.title = proj.name[:31]  # Excel limita a 31 char

    headers = ["#", "Attività", "Inizio", "Fine", "Durata (gg)", "Progresso %", "Tipo", "Priorità"]
    ws.append(headers)

    for col in range(1, len(headers) + 1):
        ws.cell(row=1, column=col).font = ws.cell(row=1, column=col).font.copy(bold=True)

    for i, task in enumerate(tasks.scalars().all(), 1):
        ws.append([
            i,
            task.text,
            str(task.start_date) if task.start_date else "",
            str(task.end_date) if task.end_date else "",
            task.duration,
            f"{task.progress * 100:.0f}%",
            task.type.value if task.type else "",
            task.priority.value if task.priority else "",
        ])

    # Larghezze colonne
    ws.column_dimensions["A"].width = 5
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 12
    ws.column_dimensions["F"].width = 12
    ws.column_dimensions["G"].width = 12
    ws.column_dimensions["H"].width = 12

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


async def export_pdf(db: AsyncSession, project_id: str) -> io.BytesIO:
    project = await db.execute(select(Project).where(Project.id == project_id))
    proj = project.scalar_one()

    tasks = await db.execute(
        select(Task).where(Task.project_id == project_id).order_by(Task.sort_order)
    )
    task_list = tasks.scalars().all()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=15 * mm, bottomMargin=15 * mm)
    styles = getSampleStyleSheet()
    elements = []

    # Titolo
    elements.append(Paragraph(f"<b>{proj.name}</b> — Piano di Progetto", styles["Title"]))
    if proj.description:
        elements.append(Paragraph(proj.description, styles["Normal"]))
    elements.append(Spacer(1, 10 * mm))

    # Tabella
    data = [["#", "Attività", "Inizio", "Fine", "Durata", "Progresso", "Priorità"]]
    for i, task in enumerate(task_list, 1):
        data.append([
            str(i),
            task.text,
            str(task.start_date) if task.start_date else "-",
            str(task.end_date) if task.end_date else "-",
            f"{task.duration}g",
            f"{task.progress * 100:.0f}%",
            task.priority.value if task.priority else "-",
        ])

    table = Table(data, colWidths=[25, 200, 75, 75, 50, 60, 60])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4338ca")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ALIGN", (1, 1), (1, -1), "LEFT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f3ff")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)
    return buffer
