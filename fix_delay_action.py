import math

def do_fix():
    with open('backend/app/services/replanning_service.py', 'r') as f:
        content = f.read()
    
    # We will replace the delay calculation logic to compute days_to_add
    
    old_delay_calc = """            if has_critical_delay:
                target_start = today
                shift_days = get_working_days_count(task.start_date, target_start) - 1
                if shift_days <= 0: shift_days = 1
                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "worker": None,
                    "date": str(first_delayed_date),
                    "reason": f"Il {first_delayed_date.strftime('%d/%m/%Y')} non ha consuntivato le ore giornaliere attese ({round(ore_gg, 1)}h).",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": shift_days
                    },
                    "action_label": f"Sposta '{task.text}' a partire da oggi"
                })"""
    
    new_delay_calc = """            if has_critical_delay:
                tot_expected_so_far = 0
                tot_actual_so_far = 0
                c_d = task.start_date
                import math
                from datetime import timedelta
                while c_d <= today and c_d <= task.end_date:
                    if not is_weekend_or_holiday(c_d):
                        tot_expected_so_far += ore_gg
                        date_str = c_d.strftime("%Y-%m-%d")
                        for day_map in actual_h_map.values():
                            if isinstance(day_map, dict) and date_str in day_map:
                                try:
                                    tot_actual_so_far += float(day_map[date_str])
                                except:
                                    pass
                    c_d += timedelta(days=1)
                lost_hours = tot_expected_so_far - tot_actual_so_far
                days_to_add = math.ceil(lost_hours / ore_gg) if (ore_gg > 0 and lost_hours > 0) else 1
                if days_to_add <= 0: days_to_add = 1

                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "worker": None,
                    "date": str(first_delayed_date),
                    "reason": f"Mancano all'appello circa {round(lost_hours, 1)}h rispetto al piano.",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": days_to_add,
                        "add_hours": round(lost_hours, 1)
                    },
                    "action_label": f"Estendi '{task.text}' di {days_to_add} { 'giorno' if days_to_add == 1 else 'giorni' } per recuperare"
                })"""

    content = content.replace(old_delay_calc, new_delay_calc)

    # Replace Fallback
    old_fallback = """            elif task.end_date < today:
                # Fallback: scaduta e non in sforamento / ritardo critico specifico
                target_start = today
                shift_days = get_working_days_count(task.start_date, target_start) - 1
                if shift_days <= 0: shift_days = 1
                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "worker": None,
                    "date": str(task.end_date),
                    "reason": f"La fase è scaduta il {task.end_date.strftime('%d/%m/%Y')} ma non risulta completata.",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": shift_days
                    },
                    "action_label": f"Sposta '{task.text}' a partire da oggi"
                })"""
    
    new_fallback = """            elif task.end_date < today:
                # Fallback: scaduta e non in sforamento / ritardo critico specifico
                days_to_add = get_working_days_count(task.end_date, today)
                if days_to_add <= 0: days_to_add = 1
                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "worker": None,
                    "date": str(task.end_date),
                    "reason": f"La fase è scaduta il {task.end_date.strftime('%d/%m/%Y')} ma non risulta completata.",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": days_to_add,
                        "add_hours": 0
                    },
                    "action_label": f"Estendi '{task.text}' di {days_to_add} { 'giorno' if days_to_add == 1 else 'giorni' } fino ad oggi"
                })"""
    content = content.replace(old_fallback, new_fallback)

    # For Sforamento (line 152)
    old_sforamento = """                "action_type": ReplanActionType.SHIFT_DELAY.value,
                "action_payload": {
                    "task_id": str(task.id),
                    "shift_days": 1
                },
                "action_label": f"Sposta '{task.text}' in avanti per ripianificare\""""
    new_sforamento = """                "action_type": ReplanActionType.SHIFT_DELAY.value,
                "action_payload": {
                    "task_id": str(task.id),
                    "shift_days": 1,
                    "add_hours": round(tot_eff - planned_h, 1)
                },
                "action_label": f"Estendi '{task.text}' di 1 giorno e adegua ore\""""
    content = content.replace(old_sforamento, new_sforamento)

    with open('backend/app/services/replanning_service.py', 'w') as f:
        f.write(content)

do_fix()
