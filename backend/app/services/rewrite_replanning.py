import json

def rewrite_replanning():
    with open('app/services/replanning_service.py', 'r') as f:
        content = f.read()

    # 1. Delay & Overrun logic
    delay_old = """
        # Ritardo (Delay): scaduta e non completata
        if task.end_date < today:
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
            })
            
        # Ore non consuntivate: iniziata in passato, e nessuna ora consuntivata
        if task.start_date < today and (not task.actual_hours or task.actual_hours in ("{}", "[]", "", "null")):
            target_start = today
            shift_days = get_working_days_count(task.start_date, target_start) - 1
            if shift_days <= 0: shift_days = 1
            sugg_id = str(uuid4())
            suggestions.append({
                "id": sugg_id,
                "type": "unaccounted_conflict",
                "task_id": str(task.id),
                "task_name": task.text,
                "project_id": str(task.project_id),
                "project_name": task.project.name if task.project else "-",
                "worker": None,
                "date": str(task.start_date),
                "reason": f"La fase è iniziata il {task.start_date.strftime('%d/%m/%Y')} ma non ha ore consuntivate.",
                "action_type": ReplanActionType.WARNING_UNACCOUNTED.value,
                "action_payload": {
                    "task_id": str(task.id),
                    "shift_days": shift_days
                },
                "action_label": f"Sposta '{task.text}' a partire da oggi"
            })
"""

    delay_new = """
        # Ritardo Critico (Motore Semafori)
        # Parse actual_hours
        try:
            actual_h_map = json.loads(task.actual_hours) if task.actual_hours else {}
        except:
            actual_h_map = {}
            
        tot_eff = 0
        for day_map in actual_h_map.values():
            if isinstance(day_map, dict):
                for h in day_map.values():
                    try:
                        tot_eff += float(h)
                    except:
                        pass
                        
        planned_h = float(task.planned_hours or 8.0)
        
        # 1. Sforamento
        if planned_h > 0 and tot_eff > planned_h:
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
                "reason": f"La fase ha superato le ore previste ({round(tot_eff, 1)}h consuntivate su {planned_h}h previste).",
                "action_type": ReplanActionType.SHIFT_DELAY.value,
                "action_payload": {
                    "task_id": str(task.id),
                    "shift_days": 1
                },
                "action_label": f"Sposta '{task.text}' in avanti per ripianificare"
            })
        else:
            # 2. Ritardo Giornaliero
            working_days = get_working_days_count(task.start_date, task.end_date)
            ore_gg = planned_h / working_days
            
            cur_d = task.start_date
            has_critical_delay = False
            first_delayed_date = None
            
            while cur_d <= task.end_date and cur_d <= today:
                if not is_weekend_or_holiday(cur_d):
                    date_str = cur_d.strftime("%Y-%m-%d")
                    tot_day_eff = 0
                    for day_map in actual_h_map.values():
                        if isinstance(day_map, dict) and date_str in day_map:
                            try:
                                tot_day_eff += float(day_map[date_str])
                            except:
                                pass
                                
                    if tot_day_eff < (ore_gg * 0.5) or (tot_day_eff == 0 and ore_gg > 0):
                        has_critical_delay = True
                        first_delayed_date = cur_d
                        break
                cur_d += timedelta(days=1)
                
            if has_critical_delay:
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
                    "reason": f"Ritardo critico: il {first_delayed_date.strftime('%d/%m/%Y')} ha consuntivato meno del 50% delle ore giornaliere attese ({round(ore_gg, 1)}h).",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": shift_days
                    },
                    "action_label": f"Sposta '{task.text}' a partire da oggi"
                })
            elif task.end_date < today:
                # Fallback: scaduta
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
                })
"""

    if delay_old.strip() in content:
        content = content.replace(delay_old.strip(), delay_new.strip())
    else:
        print("COULD NOT FIND OLD DELAY LOGIC")
        return

    # 2. Worker Workload Alignment
    workload_old = """
                    total_h = float(worker_hours.get(w, task.planned_hours or 0))
                    daily_h = total_h / duration_days
"""

    workload_new = """
                    if w in worker_hours and worker_hours[w] is not None:
                        try:
                            total_h = float(worker_hours[w])
                        except Exception:
                            total_h = float(task.planned_hours or 0) / len(workers)
                    else:
                        total_h = float(task.planned_hours or 0) / len(workers)
                    daily_h = total_h / duration_days
"""
    if workload_old.strip() in content:
        content = content.replace(workload_old.strip(), workload_new.strip())
    else:
        print("COULD NOT FIND OLD WORKLOAD LOGIC")
        return

    with open('app/services/replanning_service.py', 'w') as f:
        f.write(content)

    print("Success")

rewrite_replanning()
