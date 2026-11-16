# eCapital in 300 words, for the joint rollout plan

16/11/2026. Answer to the rollout-planning session's five questions. No
passwords, keys or tokens.

**1. What it does, who uses it.** One register for the twelve ΟΚΥπΥ units.
Capital projects (phases, milestones, risks, budget) and their contracts
(BOQ, variations, payment certificates, RFIs, site instructions, defects,
sections, extensions of time, delay penalties, claims). Shutdown permits
with ICRA and clinical approval. Asset register with QR labels. Maintenance:
work orders with SLA timers, preventive programme, backlog, contractor
scorecard. Seven reports with Excel and PDF. Users: Technical Services per
hospital (head of estates, engineers, technicians), finance, infection
control and ward approvers, executives and auditors read-only, one
administrator with an editable role matrix.

**2. Data in and out.** In: typed on screens; Excel Capex plan import with
validation; SAP extracts as files (ME2N, KSB1, FBL1N); SLA catalogue Excel.
Out: screens, Excel with live formulas, print-to-PDF, JSON API behind the
web app.

**3. SAP.** Needs: cost centres, CAPEX budget codes (commitment items), WBS,
vendor codes, and the actuals extracts above. Sends nothing to SAP
directly; contracts go to eFinance, which owns the SAP side. The asset
register is the item-level fixed asset list SAP lacks; a reconciliation to
SAP categories is designed, not built.

**4. Other tools.** eFinance: contract push, invoices, requisitions and
budget position read live; entity codes now eFinance's. eArchive: every
filed document goes there with a protocol number; token not yet on the
server. eMAP: link-outs by contract reference. eBoard, eHealth, eHR, TAEP
calculator: nothing yet. Login: Active Directory via LDAP designed, waiting
on IT; local accounts meanwhile. Own PostgreSQL database.

**5. Rollout.** Ready: the application on `ecapital.shso.online`, all
modules, guides, UAT scenarios, sample data. Not ready: real project
register not loaded; LDAP; eArchive token; penalty amounts for the Nicosia
maintenance catalogue; scheduled e-mail reports (needs SMTP). First: load
the real Capex register, name one accountable unit, pilot in one or two
hospitals.
