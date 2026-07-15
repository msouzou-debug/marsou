"""v2 SAP adapter — NOT ACTIVE. Do not wire in until IT delivers an interface
user and a test client (§11 Phase 5). v1's park_file.py remains the fallback.

Interface spec (agreed direction, §2):
- PO invoices:  BAPI_INCOMINGINVOICE_PARK
    HEADERDATA: INVOICE_IND='X', DOC_TYPE='RE', DOC_DATE, PSTNG_DATE, REF_DOC_NO,
                COMP_CODE, CURRENCY, GROSS_AMOUNT, CALC_TAX_IND='X'
    ITEMDATA:   per line: PO_NUMBER, PO_ITEM, TAX_CODE, ITEM_AMOUNT, QUANTITY, PO_UNIT
- FI invoices:  BAPI_ACC_DOCUMENT_POST in park/hold mode
    DOCUMENTHEADER: BUS_ACT='RFBU', DOC_TYPE='KR', COMP_CODE, DOC_DATE, PSTNG_DATE
    ACCOUNTPAYABLE: vendor line (ITEMNO 1, VENDOR_NO, negative gross)
    ACCOUNTGL:      one line per invoice line (GL_ACCOUNT, COSTCENTER, amount, TAX_CODE)
- Connection: pyrfc / SAP NW RFC SDK, dedicated interface user, least privilege
  (park only, no posting/payment authorizations).
- Every call and SAP document number goes into the audit log; on any BAPI
  error the invoice falls back to the batch file path.
"""


class BapiNotConfigured(Exception):
    pass


def park_invoice(conn, settings, invoice_id):
    raise BapiNotConfigured(
        "Phase 5 not started: waiting for SAP interface user + test client from IT"
    )
