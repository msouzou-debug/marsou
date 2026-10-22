# -*- coding: utf-8 -*-
"""The two-week parallel run (brief §15).

The point of this exercise is not that a fortnight passes. It is that every episode was
priced both ways and every difference was explained. These tests hold that line.
"""
import datetime as dt
from decimal import Decimal
from io import BytesIO

import pytest

import taep
from taep import CostingError


def finalise(client, app, **overrides):
    from test_taep_routes import form_fields
    response = client.post("/taep/nea", data=form_fields(app.ctx, **overrides))
    import re
    episode_id = int(re.search(r"/taep/(\d+)", response.headers["Location"]).group(1))
    client.post("/taep/%d/services" % episode_id,
                data={"service_code": ["AED008", "AET057"]})
    client.post("/taep/%d/calculate" % episode_id)
    client.post("/taep/%d/finalise" % episode_id)
    return episode_id


def test_a_manual_figure_is_recorded_against_the_episode(client, app):
    episode_id = finalise(client, app)
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": "120,00"})

    rows = taep.parallel_run_rows(app.ctx, "NGH")
    assert len(rows) == 1
    assert rows[0]["manual"] == Decimal("120.00")
    assert rows[0]["recorded"] is True


@pytest.mark.parametrize("typed,expected", [
    ("120,00", Decimal("120.00")),      # Greek decimal comma, which is what they type
    ("120.00", Decimal("120.00")),
    (" 95 ", Decimal("95.00")),
])
def test_the_amount_is_read_the_way_a_clerk_writes_it(seeded, typed, expected):
    from test_taep_routes import form_fields
    assert taep.money(Decimal(str(typed).replace(",", ".").strip())) == expected


def test_a_manual_figure_replaces_rather_than_doubles(client, app):
    """A clerk correcting their own arithmetic is normal; two rows would miscount."""
    episode_id = finalise(client, app)
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": "100"})
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": "120"})

    rows = app.ctx["db_execute"](
        "SELECT manual_amount FROM taep_parallel_check WHERE episode_id=%s",
        (episode_id,), fetch=True)
    assert len(rows) == 1
    assert taep.money_from_db(rows[0]["manual_amount"]) == Decimal("120.00")


def test_only_a_finalised_episode_can_be_recorded_against(client, app):
    from test_taep_routes import form_fields
    import re
    response = client.post("/taep/nea", data=form_fields(app.ctx))
    episode_id = int(re.search(r"/taep/(\d+)", response.headers["Location"]).group(1))
    with pytest.raises(CostingError) as caught:
        taep.record_parallel_check(app.ctx, episode_id, "100", 1)
    assert caught.value.code == "NOT_FINALISED"


def test_a_difference_of_one_cent_is_a_difference(client, app):
    """No tolerance. A cent apart means the two methods disagree, and that is the
    whole point of running them side by side."""
    episode_id = finalise(client, app)
    tool = taep.price_episode(app.ctx, episode_id).total_cost
    client.post("/taep/%d/parallel" % episode_id,
                data={"manual_amount": str(tool + Decimal("0.01"))})

    row = taep.parallel_run_rows(app.ctx, "NGH")[0]
    assert row["differs"] is True
    assert row["difference"] == Decimal("0.01")


def test_an_agreeing_figure_is_not_a_difference(client, app):
    episode_id = finalise(client, app)
    tool = taep.price_episode(app.ctx, episode_id).total_cost
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": str(tool)})
    row = taep.parallel_run_rows(app.ctx, "NGH")[0]
    assert row["differs"] is False
    assert row["difference"] == Decimal("0.00")


def test_the_run_is_not_complete_while_a_difference_is_unexplained(client, app):
    episode_id = finalise(client, app)
    tool = taep.price_episode(app.ctx, episode_id).total_cost
    client.post("/taep/%d/parallel" % episode_id,
                data={"manual_amount": str(tool + Decimal("10"))})

    summary = taep.parallel_run_summary(taep.parallel_run_rows(app.ctx, "NGH"))
    assert summary["ready"] is False
    assert summary["unexplained"] == 1
    assert any("δεν έχουν διερευνηθεί" in b for b in summary["blockers"])

    taep.resolve_parallel_check(app.ctx, episode_id,
                                "Ο κωδικοποιητής είχε χρεώσει τέλος εγγραφής δύο φορές.",
                                user_id=1)
    summary = taep.parallel_run_summary(taep.parallel_run_rows(app.ctx, "NGH"))
    assert summary["unexplained"] == 0
    assert not any("διερευνηθεί" in b for b in summary["blockers"])


def test_an_episode_with_no_manual_figure_blocks_completion(client, app):
    finalise(client, app)
    summary = taep.parallel_run_summary(taep.parallel_run_rows(app.ctx, "NGH"))
    assert summary["missing"] == 1
    assert summary["ready"] is False
    assert any("χειρόγραφο ποσό" in b for b in summary["blockers"])


def test_a_resolution_cannot_be_blank(client, app):
    episode_id = finalise(client, app)
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": "999"})
    with pytest.raises(CostingError) as caught:
        taep.resolve_parallel_check(app.ctx, episode_id, "   ", user_id=1)
    assert caught.value.code == "NO_RESOLUTION"


def test_fourteen_days_is_required_however_clean_the_figures(client, app):
    """One perfect day is not a parallel run."""
    episode_id = finalise(client, app)
    tool = taep.price_episode(app.ctx, episode_id).total_cost
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": str(tool)})

    summary = taep.parallel_run_summary(taep.parallel_run_rows(app.ctx, "NGH"))
    assert summary["missing"] == 0 and summary["unexplained"] == 0
    assert summary["ready"] is False
    assert any("ημέρες" in b for b in summary["blockers"])


def test_the_run_completes_when_every_condition_is_met(client, app):
    """Fourteen distinct days, every episode priced twice, nothing unexplained."""
    base = dt.datetime.now() - dt.timedelta(days=20)
    for day in range(14):
        when = base + dt.timedelta(days=day)
        episode_id = finalise(
            client, app, episode_number="E-%d" % day,
            admission_at=when.strftime("%Y-%m-%dT%H:%M"),
            examination_at=(when + dt.timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M"),
            discharge_at=(when + dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"))
        tool = taep.price_episode(app.ctx, episode_id).total_cost
        client.post("/taep/%d/parallel" % episode_id,
                    data={"manual_amount": str(tool)})

    summary = taep.parallel_run_summary(taep.parallel_run_rows(app.ctx, "NGH"))
    assert summary["days"] == 14
    assert summary["episodes"] == 14 and summary["recorded"] == 14
    assert summary["blockers"] == []
    assert summary["ready"] is True


def test_the_report_is_scoped_to_one_hospital(client, app):
    """Brief §13 again: the Μονάδα of one hospital does not audit another's."""
    episode_id = finalise(client, app)
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": "100"})
    app.ctx["db_execute"]("UPDATE taep_episode SET entity_code='LGH' WHERE id=%s",
                          (episode_id,))
    assert taep.parallel_run_rows(app.ctx, "NGH") == []
    assert len(taep.parallel_run_rows(app.ctx, "LGH")) == 1


# ---------------------------------------------------------------------------
# The workbook. Every derived figure must be a formula a reviewer can follow.
# ---------------------------------------------------------------------------

def read_sheet(data):
    from openpyxl import load_workbook
    return load_workbook(BytesIO(data)).active


def test_the_difference_column_is_a_formula_not_a_pasted_number(client, app):
    episode_id = finalise(client, app)
    tool = taep.price_episode(app.ctx, episode_id).total_cost
    client.post("/taep/%d/parallel" % episode_id,
                data={"manual_amount": str(tool + Decimal("5"))})

    sheet = read_sheet(taep.export_parallel_workbook(app.ctx, "NGH"))
    assert sheet["J2"].value.startswith("=IF(COUNT(H2:I2)=2,I2-H2")
    # the inputs it works from are real numbers
    assert sheet["H2"].value == float(tool)
    assert sheet["I2"].value == float(tool + Decimal("5"))


def test_every_summary_figure_is_a_formula(client, app):
    episode_id = finalise(client, app)
    client.post("/taep/%d/parallel" % episode_id, data={"manual_amount": "100"})
    sheet = read_sheet(taep.export_parallel_workbook(app.ctx, "NGH"))

    formulas = [cell.value for row in sheet.iter_rows(min_col=2, max_col=2)
                for cell in row if isinstance(cell.value, str)
                and cell.value.startswith("=")]
    assert len(formulas) >= 8
    assert any(f.startswith("=SUM(H2:") for f in formulas)
    assert any(f.startswith("=SUM(I2:") for f in formulas)
    assert any("COUNTIF" in f for f in formulas)


def test_the_workbook_states_the_verdict_in_words(client, app):
    finalise(client, app)
    sheet = read_sheet(taep.export_parallel_workbook(app.ctx, "NGH"))
    text = " ".join(str(c.value) for row in sheet.iter_rows() for c in row
                    if c.value is not None)
    assert "ΔΕΝ έχει ολοκληρωθεί" in text
    assert "δεν έχουν χειρόγραφο ποσό" in text


def test_the_formulas_compute_what_python_computed(client, app):
    """Replicate the workbook's arithmetic, because LibreOffice cannot open a file in
    this container and a formula nobody evaluates is a formula nobody has checked."""
    amounts = []
    for index, extra in enumerate(("0", "5", "-2.50")):
        episode_id = finalise(client, app, episode_number="E-%d" % index)
        tool = taep.price_episode(app.ctx, episode_id).total_cost
        manual = tool + Decimal(extra)
        client.post("/taep/%d/parallel" % episode_id,
                    data={"manual_amount": str(manual)})
        amounts.append((tool, manual))

    sheet = read_sheet(taep.export_parallel_workbook(app.ctx, "NGH"))
    tool_cells = [sheet.cell(row=r, column=8).value for r in range(2, 5)]
    manual_cells = [sheet.cell(row=r, column=9).value for r in range(2, 5)]

    assert sorted(tool_cells) == sorted(float(t) for t, _ in amounts)
    assert sorted(manual_cells) == sorted(float(m) for _, m in amounts)
    # =I-H per row, and =SUM(I)-SUM(H) at the foot, both evaluated here
    assert [round(m - t, 2) for t, m in zip(tool_cells, manual_cells)] == \
        [round(float(m - t), 2) for t, m in amounts]
    assert round(sum(manual_cells) - sum(tool_cells), 2) == \
        round(float(sum(m for _, m in amounts) - sum(t for t, _ in amounts)), 2)


# ---------------------------------------------------------------------------
# Who may see and change it
# ---------------------------------------------------------------------------

def test_the_report_needs_the_admin_key(client, app):
    granted = app.ctx["granted_permissions"]
    granted.clear()
    granted.update({taep.PERMISSIONS["create"], taep.PERMISSIONS["finalise"]})
    assert client.get("/taep/parallel").status_code == 403
    assert client.get("/taep/parallel/export").status_code == 403

    granted.add(taep.PERMISSIONS["admin"])
    assert client.get("/taep/parallel").status_code == 200


def test_a_cashier_cannot_record_a_manual_figure(client, app):
    episode_id = finalise(client, app)
    granted = app.ctx["granted_permissions"]
    granted.clear()
    granted.add(taep.PERMISSIONS["view"])
    assert client.post("/taep/%d/parallel" % episode_id,
                       data={"manual_amount": "100"}).status_code == 403


def test_the_screen_names_what_is_still_missing(client, app):
    finalise(client, app)
    page = client.get("/taep/parallel").get_data(as_text=True)
    assert "Δεν έχει ολοκληρωθεί" in page
    assert "δεν έχουν χειρόγραφο ποσό" in page
    assert "Λείπει" in page
