import io
import json
from typing import List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task
from app.models.project import Project
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side


def _extract_task_info(task: Task) -> Tuple[str, float, float, float]:
    # Lista addetti
    workers_list = []
    if task.workers:
        try:
            parsed_w = json.loads(task.workers)
            if isinstance(parsed_w, list):
                workers_list = parsed_w
        except Exception:
            pass
    workers_str = ", ".join(workers_list) if workers_list else "-"

    # Somma ore consuntivate effettive
    t_eff = 0.0
    if task.actual_hours:
        try:
            parsed_h = json.loads(task.actual_hours)
            if isinstance(parsed_h, dict):
                for day_map in parsed_h.values():
                    if isinstance(day_map, dict):
                        for h in day_map.values():
                            try:
                                t_eff += float(h)
                            except (ValueError, TypeError):
                                pass
        except Exception:
            pass

    planned = float(task.planned_hours or 0.0)
    diff = t_eff - planned
    return workers_str, planned, t_eff, diff


async def export_excel(db: AsyncSession, project_id: str) -> io.BytesIO:
    project = await db.execute(select(Project).where(Project.id == project_id))
    proj = project.scalar_one()

    tasks = await db.execute(
        select(Task).where(Task.project_id == project_id).order_by(Task.sort_order)
    )
    task_list = tasks.scalars().all()

    wb = Workbook()
    ws = wb.active
    ws.title = proj.name[:31] if proj.name else "Commessa"

    # Stili Excel
    header_fill = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=11)
    summary_font = Font(bold=True, size=11, color="1E3A8A")
    summary_fill = PatternFill(start_color="DBEAFE", end_color="DBEAFE", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="D1D5DB"),
        right=Side(style="thin", color="D1D5DB"),
        top=Side(style="thin", color="D1D5DB"),
        bottom=Side(style="thin", color="D1D5DB")
    )

    # Titolo del report
    ws.append([f"COMMESSA: {proj.code or ''} - {proj.name}"])
    ws.cell(row=1, column=1).font = Font(size=14, bold=True, color="1E3A8A")
    if proj.client:
        ws.append([f"Cliente: {proj.client}"])
        ws.cell(row=2, column=1).font = Font(size=11, italic=True)
    else:
        ws.append([])
    ws.append([])

    headers = [
        "#",
        "Fase / Attività",
        "Inizio",
        "Fine",
        "Durata (gg)",
        "Ore Budget (h)",
        "Ore Consuntivate (h)",
        "Saldo Ore (h)",
        "Addetti Assegnati",
        "Progresso %",
        "Tipo",
        "Priorità"
    ]
    ws.append(headers)
    header_row_idx = ws.max_row

    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=header_row_idx, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border

    tot_days = 0
    tot_planned = 0.0
    tot_actual = 0.0

    for i, task in enumerate(task_list, 1):
        workers_str, planned, t_eff, diff = _extract_task_info(task)
        tot_days += int(task.duration or 0)
        tot_planned += planned
        tot_actual += t_eff

        row_data = [
            i,
            task.text,
            str(task.start_date) if task.start_date else "",
            str(task.end_date) if task.end_date else "",
            task.duration,
            round(planned, 1),
            round(t_eff, 1),
            round(diff, 1),
            workers_str,
            f"{task.progress * 100:.0f}%",
            task.type.value if task.type else "",
            task.priority.value if task.priority else ""
        ]
        ws.append(row_data)
        current_row = ws.max_row
        for col_idx in range(1, len(row_data) + 1):
            c = ws.cell(row=current_row, column=col_idx)
            c.border = thin_border
            if col_idx in [1, 3, 4, 5, 6, 7, 8, 10, 11, 12]:
                c.alignment = Alignment(horizontal="center", vertical="center")
            else:
                c.alignment = Alignment(horizontal="left", vertical="center")

    # Riga Totale
    tot_diff = tot_actual - tot_planned
    ws.append([])
    tot_row = [
        "",
        "TOTALE COMMESSA:",
        "",
        "",
        tot_days,
        round(tot_planned, 1),
        round(tot_actual, 1),
        round(tot_diff, 1),
        "",
        "",
        "",
        ""
    ]
    ws.append(tot_row)
    tot_row_idx = ws.max_row
    for col_idx in range(1, len(tot_row) + 1):
        c = ws.cell(row=tot_row_idx, column=col_idx)
        c.fill = summary_fill
        c.font = summary_font
        c.border = thin_border
        if col_idx in [5, 6, 7, 8]:
            c.alignment = Alignment(horizontal="center", vertical="center")

    # Larghezze colonne ottimizzate
    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 38
    ws.column_dimensions["C"].width = 13
    ws.column_dimensions["D"].width = 13
    ws.column_dimensions["E"].width = 13
    ws.column_dimensions["F"].width = 16
    ws.column_dimensions["G"].width = 20
    ws.column_dimensions["H"].width = 15
    ws.column_dimensions["I"].width = 30
    ws.column_dimensions["J"].width = 14
    ws.column_dimensions["K"].width = 12
    ws.column_dimensions["L"].width = 12

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
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4), topMargin=12 * mm, bottomMargin=12 * mm, leftMargin=12 * mm, rightMargin=12 * mm
    )
    styles = getSampleStyleSheet()
    elements = []

    # Stili di testo per le celle (affinché il testo lungo vada a capo)
    cell_left = ParagraphStyle(
        'CellLeft',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor('#1e293b'),
    )
    cell_center = ParagraphStyle(
        'CellCenter',
        parent=cell_left,
        alignment=1,
    )
    cell_bold_center = ParagraphStyle(
        'CellBoldCenter',
        parent=cell_center,
        fontName='Helvetica-Bold',
    )
    cell_bold_left = ParagraphStyle(
        'CellBoldLeft',
        parent=cell_left,
        fontName='Helvetica-Bold',
    )
    header_style = ParagraphStyle(
        'HeaderCell',
        parent=cell_center,
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white,
    )

    # Titolo
    elements.append(Paragraph(f"<b>{proj.code or ''} {proj.name}</b> — Report Dettagliato Fasi e Consuntivazione Ore", styles["Title"]))
    if proj.client or proj.description:
        s = f"<b>Cliente:</b> {proj.client or '-'} | <b>Descrizione:</b> {proj.description or '-'}"
        elements.append(Paragraph(s, styles["Normal"]))
    elements.append(Spacer(1, 4 * mm))

    # Calcolo totali prima della tabella
    tot_days = 0
    tot_planned = 0.0
    tot_actual = 0.0
    for task in task_list:
        workers_str, planned, t_eff, diff = _extract_task_info(task)
        tot_days += int(task.duration or 0)
        tot_planned += planned
        tot_actual += t_eff
    tot_diff = tot_actual - tot_planned

    # Tabella Riepilogo KPI
    kpi_data = [
        [
            Paragraph("<b>Fasi Totali</b>", cell_center),
            Paragraph("<b>Durata Stimata</b>", cell_center),
            Paragraph("<b>Budget Ore</b>", cell_center),
            Paragraph("<b>Ore Consuntivate</b>", cell_center),
            Paragraph("<b>Saldo Ore</b>", cell_center)
        ],
        [
            Paragraph(f"<b>{len(task_list)}</b>", cell_center),
            Paragraph(f"<b>{tot_days} giorni</b>", cell_center),
            Paragraph(f"<b>{tot_planned:.1f} h</b>", cell_center),
            Paragraph(f"<b>{tot_actual:.1f} h</b>", cell_center),
            Paragraph(f"<b>{tot_diff:+.1f} h</b>", cell_center)
        ]
    ]
    kpi_table = Table(kpi_data, colWidths=[140, 140, 160, 160, 160])
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFF6FF")),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#DBEAFE")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#93C5FD")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(kpi_table)
    elements.append(Spacer(1, 6 * mm))

    # Tabella Principale Dettaglio Fasi
    headers = [
        Paragraph("#", header_style),
        Paragraph("Fase / Attività", header_style),
        Paragraph("Inizio", header_style),
        Paragraph("Fine", header_style),
        Paragraph("Giorni", header_style),
        Paragraph("Ore<br/>Budget", header_style),
        Paragraph("Ore<br/>Effett.", header_style),
        Paragraph("Saldo<br/>Ore", header_style),
        Paragraph("Addetti Assegnati", header_style),
        Paragraph("Prog.", header_style),
        Paragraph("Priorità", header_style)
    ]
    data = [headers]

    for i, task in enumerate(task_list, 1):
        workers_str, planned, t_eff, diff = _extract_task_info(task)
        diff_str = f"{diff:+.1f}h" if abs(diff) > 0.05 else "0.0h"
        
        data.append([
            Paragraph(str(i), cell_center),
            Paragraph(task.text, cell_left),
            Paragraph(str(task.start_date) if task.start_date else "-", cell_center),
            Paragraph(str(task.end_date) if task.end_date else "-", cell_center),
            Paragraph(f"{task.duration}g", cell_center),
            Paragraph(f"{planned:.1f}h", cell_center),
            Paragraph(f"{t_eff:.1f}h", cell_center),
            Paragraph(diff_str, cell_center),
            Paragraph(workers_str, cell_left),
            Paragraph(f"{task.progress * 100:.0f}%", cell_center),
            Paragraph(task.priority.value if task.priority else "-", cell_center)
        ])

    # Riga finale totali nella tabella principale
    tot_diff_str = f"{tot_diff:+.1f}h" if abs(tot_diff) > 0.05 else "0.0h"
    data.append([
        Paragraph("", cell_center),
        Paragraph("<b>TOTALE COMMESSA</b>", cell_bold_left),
        Paragraph("", cell_center),
        Paragraph("", cell_center),
        Paragraph(f"<b>{tot_days}g</b>", cell_bold_center),
        Paragraph(f"<b>{tot_planned:.1f}h</b>", cell_bold_center),
        Paragraph(f"<b>{tot_actual:.1f}h</b>", cell_bold_center),
        Paragraph(f"<b>{tot_diff_str}</b>", cell_bold_center),
        Paragraph("", cell_left),
        Paragraph("", cell_center),
        Paragraph("", cell_center)
    ])

    # Larghezze per un totale di 760 pt (268 mm circa, perfetto per A4 orizzontale)
    # 22 + 155 + 58 + 58 + 42 + 52 + 52 + 52 + 165 + 48 + 56 = 760
    col_widths = [22, 155, 58, 58, 42, 52, 52, 52, 165, 48, 56]
    table = Table(data, colWidths=col_widths)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F8FAFC")]),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)
    return buffer
