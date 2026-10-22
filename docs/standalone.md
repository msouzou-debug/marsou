# Η Κοστολόγηση ΤΑΕΠ ως αυτόνομο λογισμικό

Δύο τρόποι λειτουργίας, ένας κώδικας:

| | Μέσα στο eFinance | Αυτόνομα |
|---|---|---|
| Διεύθυνση | `http://<eFinance>/taep/...` | `https://taep.okypy.local/` |
| Είσοδος | οι χρήστες του eFinance | `host_user` στη βάση του ΤΑΕΠ |
| Βάση | `finance.db` | `taep.db` |
| Εκκίνηση | `finance.service` | `taep.service` |
| Αρχείο εφαρμογής | `/opt/finance/taep.py` | `/opt/taep/taep.py` |

Το `taep.py` είναι **το ίδιο αρχείο**. Δεν υπάρχει αντίγραφο και δεν υπάρχει δεύτερη
έκδοση. Ό,τι διορθώνεται σε έναν τρόπο λειτουργίας ισχύει και στον άλλο.

---

## 1. Γιατί δουλεύει χωρίς αλλαγές

Το module ζητά επτά πράγματα από τον host του, μέσα από ένα λεξικό `ctx`:

```
db_execute  login_required  permission_required  has_permission
user_entity  can_access_entity  log_activity
```

Η λίστα είναι γραμμένη στο `taep.REQUIRED_CTX_KEYS`. Το eFinance τα δίνει από το
`app.py`· το `standalone/host.py` τα δίνει μόνο του, σε 280 γραμμές. Το
`test_standalone.py` ελέγχει ότι ο αυτόνομος host δίνει και τα επτά — αν προστεθεί
όγδοιο κλειδί, η δοκιμή χτυπά αμέσως αντί να χτυπήσει ο χρήστης.

Μια διαφορά που κρατήθηκε επίτηδες: **ένας κεντρικός ρόλος ανοίγει κάθε κοστολόγηση
με τον αριθμό ή το id, αλλά η λίστα του δείχνει μόνο το δικό του νοσηλευτήριο.** Αυτό
είναι η συμπεριφορά του eFinance σήμερα (`docs/note-to-efinance-agent-entity-scoping.md`
§2). Δεν «διορθώθηκε» εδώ, γιατί δύο συστήματα που σχεδόν συμφωνούν είναι χειρότερα
από ένα με γνωστό περιορισμό. Αν αλλάξει, αλλάζει πρώτα στο eFinance.

## 2. Τι ΔΕΝ κάνει ο αυτόνομος host

- **Active Directory.** Οι λογαριασμοί ζουν σε δικό του πίνακα με hashed κωδικούς.
  Αν η αυτόνομη λειτουργία γίνει μόνιμη, πρέπει να συνδεθεί με AD· ένα δεύτερο
  αποθετήριο κωδικών παλιώνει.
- **Τίποτα πέρα από το ΤΑΕΠ.** Ούτε τιμολόγια, ούτε προϋπολογισμός, ούτε προμηθευτές.
- **Οδοιπορικά.** Ανήκουν στο eFinance.

## 3. Εγκατάσταση σε καθαρό διακομιστή

Ubuntu 22.04. Όλες οι εντολές ως διαχειριστής.

```bash
ssh administrator@<ο-νέος-διακομιστής>

sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv nginx
sudo useradd --system --home /opt/taep --shell /usr/sbin/nologin taep
sudo mkdir -p /opt/taep/templates /opt/taep/seed /opt/taep/static /var/log/taep
sudo chown -R taep:taep /opt/taep /var/log/taep
```

Αρχεία — από τον φάκελο του repository, με `scp` ή από αντίγραφο σε USB:

```bash
sudo install -o taep -g taep -m 644 taep.py                 /opt/taep/
sudo install -o taep -g taep -m 644 standalone/host.py      /opt/taep/
sudo install -o taep -g taep -m 644 standalone/manage.py    /opt/taep/
sudo install -o taep -g taep -m 644 standalone/templates/*  /opt/taep/templates/
sudo install -o taep -g taep -m 644 templates/taep_*.html   /opt/taep/templates/
sudo install -o taep -g taep -m 644 seed/*.csv              /opt/taep/seed/
sudo install -o taep -g taep -m 644 tools/check_readiness.py /opt/taep/
sudo install -o taep -g taep -m 644 tools/detach_from_efinance.py /opt/taep/
sudo install -o taep -g taep -m 644 tools/sqlite_backup.py      /opt/taep/
```

Ρυθμίσεις:

```bash
sudo install -o taep -g taep -m 600 standalone/settings.example.json \
     /opt/taep/settings.json
sudo -u taep python3 -c 'import secrets; print(secrets.token_hex(32))'
sudo -u taep nano /opt/taep/settings.json     # βάλτε το κλειδί στο secret_key
```

Αν λείπει το `secret_key`, η υπηρεσία ξεκινά αλλά **οι συνεδρίες χάνονται σε κάθε
επανεκκίνηση** και το μήνυμα βγαίνει μόνο στο `error.log`.

Python:

```bash
sudo pip3 install flask gunicorn reportlab openpyxl werkzeug
```

Πρώτη εκκίνηση — φτιάχνει τον πίνακα και φορτώνει τα δεδομένα βάσης:

```bash
sudo -u taep python3 /opt/taep/manage.py list-users
```

Αν ο στόχος είναι **μεταφορά από το eFinance**, μην τρέξετε αυτό ακόμα. Δείτε το §5
πρώτα: η μεταφορά θέλει κενή βάση.

Υπηρεσία και nginx:

```bash
sudo install -m 644 standalone/taep.service /etc/systemd/system/taep.service
sudo install -m 644 standalone/nginx-taep.conf /etc/nginx/sites-available/taep
sudo ln -sf /etc/nginx/sites-available/taep /etc/nginx/sites-enabled/taep
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemctl enable --now taep.service
sudo systemctl status taep.service --no-pager
```

Έλεγχος:

```bash
sudo -u taep env FINANCE_DB=/opt/taep/taep.db python3 /opt/taep/check_readiness.py
```

## 4. Χρήστες

```bash
sudo -u taep python3 /opt/taep/manage.py add-user maria "Μαρία Γεωργίου" clerk NGH
sudo -u taep python3 /opt/taep/manage.py list-users
sudo -u taep python3 /opt/taep/manage.py set-password maria
sudo -u taep python3 /opt/taep/manage.py disable-user maria
```

Ο κωδικός ζητείται από το τερματικό, ποτέ ως παράμετρος: μια παράμετρος μένει στο
ιστορικό του shell και φαίνεται στη λίστα διεργασιών.

| Ρόλος | Βλέπει | Καταχωρεί | Τιμές | Διαχείριση |
|---|---|---|---|---|
| `clerk` | ✓ | ✓ | — | — |
| `cashier` | ✓ | — | — | — |
| `rates_admin` | ✓ | — | ✓ | — |
| `admin` | ✓ | ✓ | ✓ | ✓ (όλα τα νοσηλευτήρια) |

Ο `admin` βλέπει **κάθε** νοσηλευτήριο. Δώστε τον ρόλο σε όσους λιγότερους γίνεται.

## 5. Μεταφορά δεδομένων από το eFinance

Αν το ΤΑΕΠ έτρεχε μέσα στο eFinance και έχει εκδώσει αριθμούς κοστολόγησης, πρέπει
να μεταφερθούν. Ένας αριθμός δεν επανεκδίδεται ποτέ, και χωρίς τη μεταφορά η
αρίθμηση θα ξεκινήσει πάλι από το `0001`.

Η σειρά έχει σημασία: **πρώτα η αντιγραφή, μετά η πρώτη εκκίνηση.** Η πρώτη εκκίνηση
φορτώνει τα δεδομένα βάσης, και τότε η αντιγραφή θα προσέθετε δεύτερο τιμοκατάλογο
δίπλα στον πρώτο. Το εργαλείο αρνείται να γράψει σε βάση που έχει ήδη δεδομένα ΤΑΕΠ.

```bash
# 1. Σταματήστε το eFinance, ώστε να μην γράφεται κοστολόγηση την ώρα του αντιγράφου
ssh administrator@10.227.56.22
sudo systemctl stop finance.service
sudo -u finance python3 /home/administrator/marsou/tools/sqlite_backup.py \
     /opt/finance/finance.db /tmp/finance-snapshot.db
sudo systemctl start finance.service

# 2. Φέρτε το αντίγραφο στον νέο διακομιστή
sudo scp /tmp/finance-snapshot.db administrator@<νέος>:/tmp/

# 3. Δοκιμαστική εκτέλεση — δεν γράφει τίποτα
ssh administrator@<νέος>
sudo -u taep python3 /opt/taep/detach_from_efinance.py \
     /tmp/finance-snapshot.db /opt/taep/taep.db

# 4. Αν ο πίνακας των γραμμών είναι λογικός, εκτελέστε
sudo -u taep python3 /opt/taep/detach_from_efinance.py \
     /tmp/finance-snapshot.db /opt/taep/taep.db --apply

# 5. Φτιάξτε χρήστες και ελέγξτε
sudo -u taep python3 /opt/taep/manage.py add-user ... clerk NGH
sudo -u taep env FINANCE_DB=/opt/taep/taep.db python3 /opt/taep/check_readiness.py
sudo systemctl restart taep.service
sudo rm /tmp/finance-snapshot.db
```

Το εργαλείο ξανα-αποδεικνύει μετά τη μεταφορά ότι οι αριθμοί κοστολόγησης είναι όσοι
και οι μοναδικοί τους. Αν δεν είναι, βγάζει `ΣΦΑΛΜΑ` και επιστρέφει κωδικό 1.

Δοκιμασμένο: πέντε οριστικοποιημένες κοστολογήσεις `OKY1054/0001`…`0005` μεταφέρθηκαν,
ο host ξεκίνησε στο αντίγραφο, και η επόμενη κοστολόγηση πήρε `OKY1054/0006` —
δηλαδή η σειρά συνεχίστηκε αντί να ξεκινήσει από την αρχή.

Αφαίρεση από το eFinance μετά τη μεταφορά: βγάλτε το `"taep"` από το `_MODULES`, την
περιοχή από το `AREAS` και το μπλοκ από το `base.html`. **Μην σβήσετε τους πίνακες
`taep_*` από το `finance.db`** — είναι το μόνο αντίγραφο της ιστορίας αν η μεταφορά
αποδειχθεί λάθος. Σβήνονται όταν η αυτόνομη λειτουργία κλείσει έναν μήνα καθαρά.

## 6. Αντίγραφα ασφαλείας

Ένα αρχείο, και είναι το μόνο αντίγραφο των αριθμών κοστολόγησης.

```bash
sudo crontab -e
```

```cron
15 2 * * * /usr/bin/python3 /opt/taep/sqlite_backup.py /opt/taep/taep.db /var/backups/taep/taep-$(date +\%F).db && find /var/backups/taep -name 'taep-*.db' -mtime +30 -delete
```

Το `sqlite_backup.py` και όχι `cp`: η βάση είναι σε WAL και ένα `cp` μπορεί να πιάσει
μισή εγγραφή. Χρησιμοποιεί το online backup API της Python, άρα **δεν χρειάζεται το
εργαλείο γραμμής `sqlite3`** — στον διακομιστή του eFinance δεν είναι εγκατεστημένο
(επιβεβαιώθηκε 22/10/2026). Αρνείται να γράψει πάνω σε υπάρχον αρχείο και ελέγχει ότι
το αντίγραφο ανοίγει πριν πει ότι πέτυχε.

## 7. Το ένα εξωτερικό εξάρτημα

Τα templates φορτώνουν Bootstrap, Bootstrap Icons, Select2 και jQuery από το
`cdn.jsdelivr.net`, στις **ίδιες εκδόσεις** που φορτώνει το eFinance, ώστε μια οπτική
διαφορά να σημαίνει πραγματική διαφορά. Αν ο νέος διακομιστής δεν βγαίνει στο
διαδίκτυο, οι οθόνες θα δουλεύουν αλλά θα φαίνονται άμορφες. Κατεβάστε τα πέντε
αρχεία μία φορά από μηχάνημα που βγαίνει, βάλτε τα στο `/opt/taep/static/vendor/` και
αλλάξτε τα `<link>`/`<script>` στο `templates/base.html`.

## 7a. Τίποτα από το CSS του eFinance

Τα templates του ΤΑΕΠ χρησιμοποιούν πέντε ονόματα κλάσεων που δεν ορίζει το Bootstrap:
`number`, `totals`, `grand`, `filters`, `lookup`. Μέσα στο eFinance τα παίρνουν από το
`static/css/app.css` του. **Εδώ ορίζονται στο `standalone/templates/base.html`**, άρα ο
αυτόνομος διακομιστής δεν χρειάζεται κανένα αρχείο CSS από το eFinance.

Κάθε στοιχείο κρατά και τις κλάσεις του Bootstrap που έχουν σημασία — `text-end`,
`fw-semibold`, `border-top` — άρα ένας κανόνας που λείπει δεν μπορεί να στοιχίσει λάθος
ένα ποσό ή να κρύψει ένα σύνολο. Είναι καλλωπισμός, όχι δομή.

(Η κλάση `.num` του eFinance δεν χρησιμοποιείται πλέον σε κανένα template του ΤΑΕΠ —
αντικαταστάθηκε από `text-end` στον ανασχεδιασμό της 21/10/2026.)

## 8. Επιστροφή στο eFinance

Δεν χρειάζεται αποεγκατάσταση. Προσθέστε το `"taep"` στο `_MODULES` του eFinance
όπως στο `docs/deployment-runbook.md` και σταματήστε την υπηρεσία:

```bash
ssh administrator@<νέος>
sudo systemctl disable --now taep.service
```

Η μεταφορά των δεδομένων **πίσω** προς το `finance.db` δεν έχει εργαλείο, γιατί δεν
έχει ζητηθεί. Αν χρειαστεί, είναι το ίδιο σενάριο με αντίστροφη κατεύθυνση και με ένα
επιπλέον βήμα: το `finance.db` κρατά ήδη τα δεδομένα βάσης, άρα μεταφέρονται μόνο οι
πίνακες των επεισοδίων.
