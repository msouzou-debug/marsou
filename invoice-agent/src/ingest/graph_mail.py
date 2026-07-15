"""Microsoft Graph mailbox ingest (Stage 1).

Application permissions, client-credentials flow, Mail.ReadWrite scoped to the
one shared mailbox (§2). Processed messages are MOVED to Processed/Failed —
never deleted.

The GraphClient below is the real implementation; tests and dry-runs inject a
stand-in with the same three methods (list_unread, get_attachments,
move_message), so the pipeline is testable without a tenant.
"""

import os
import zipfile
from io import BytesIO

from ..audit import log as audit
from ..common.config import graph_client_secret
from . import dedupe

GRAPH = "https://graph.microsoft.com/v1.0"
HANDLED = (".pdf", ".xml", ".p7m", ".zip")


class GraphClient:
    def __init__(self, settings):
        import msal
        import requests

        mb = settings["mailbox"]
        self._requests = requests
        self.mailbox = mb["address"]
        secret = graph_client_secret()
        if not secret:
            raise RuntimeError("GRAPH_CLIENT_SECRET not set (OS keystore / .env — see §10)")
        app = msal.ConfidentialClientApplication(
            mb["client_id"],
            authority=f"https://login.microsoftonline.com/{mb['tenant_id']}",
            client_credential=secret,
        )
        token = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" not in token:
            raise RuntimeError(f"Graph auth failed: {token.get('error_description')}")
        self._headers = {"Authorization": f"Bearer {token['access_token']}"}

    def _get(self, url, **params):
        r = self._requests.get(url, headers=self._headers, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def list_unread(self):
        url = f"{GRAPH}/users/{self.mailbox}/mailFolders/inbox/messages"
        data = self._get(url, **{"$filter": "isRead eq false and hasAttachments eq true",
                                 "$top": "50", "$select": "id,subject,from,receivedDateTime"})
        return data.get("value", [])

    def get_attachments(self, message_id):
        url = f"{GRAPH}/users/{self.mailbox}/messages/{message_id}/attachments"
        out = []
        for att in self._get(url).get("value", []):
            if att.get("@odata.type") == "#microsoft.graph.fileAttachment":
                import base64
                out.append((att["name"], base64.b64decode(att["contentBytes"])))
        return out

    def move_message(self, message_id, folder_name):
        url = f"{GRAPH}/users/{self.mailbox}/messages/{message_id}/move"
        r = self._requests.post(url, headers=self._headers,
                                json={"destinationId": self._folder_id(folder_name)}, timeout=60)
        r.raise_for_status()

    def _folder_id(self, name):
        data = self._get(f"{GRAPH}/users/{self.mailbox}/mailFolders",
                         **{"$filter": f"displayName eq '{name}'"})
        if data.get("value"):
            return data["value"][0]["id"]
        r = self._requests.post(f"{GRAPH}/users/{self.mailbox}/mailFolders",
                                headers=self._headers, json={"displayName": name}, timeout=60)
        r.raise_for_status()
        return r.json()["id"]


def ingest_mailbox(conn, settings, client, actor="system"):
    """Pull unread messages, register attachments, move to Processed/Failed."""
    staging = os.path.join(settings["folders"]["output_root"], "mail_staging")
    os.makedirs(staging, exist_ok=True)
    new_ids, skipped, failed = [], 0, 0
    for msg in client.list_unread():
        msg_id = msg["id"]
        try:
            for name, data in client.get_attachments(msg_id):
                if not name.lower().endswith(HANDLED):
                    continue
                if name.lower().endswith(".zip"):
                    members = _unzip(data)
                else:
                    members = [(name, data)]
                for member_name, member_data in members:
                    digest = dedupe.sha256_bytes(member_data)
                    if dedupe.is_known(conn, digest):
                        skipped += 1
                        continue
                    ext = os.path.splitext(member_name)[1] or ".bin"
                    path = os.path.join(staging, f"{digest}{ext}")
                    with open(path, "wb") as f:
                        f.write(member_data)
                    new_ids.append(dedupe.register_file(
                        conn, digest, member_name, path, "mailbox", mailbox_message_id=msg_id))
            client.move_message(msg_id, settings["mailbox"]["processed_folder"])
        except Exception as e:  # noqa: BLE001 — one bad message must not stop the run
            failed += 1
            try:
                client.move_message(msg_id, settings["mailbox"]["failed_folder"])
            except Exception:
                pass
            audit.log(conn, actor, "ingest_mail_failed", f"message={msg_id} error={e}")
    audit.log(conn, actor, "ingest_mailbox", f"new={len(new_ids)} skipped={skipped} failed={failed}")
    return new_ids


def _unzip(data):
    out = []
    with zipfile.ZipFile(BytesIO(data)) as zf:
        for info in zf.infolist():
            if not info.is_dir() and info.filename.lower().endswith((".pdf", ".xml", ".p7m")):
                out.append((os.path.basename(info.filename), zf.read(info)))
    return out
