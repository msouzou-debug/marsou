# eCapital on your own PC

For looking at the screens with the sample register, on a Windows PC, with no
server, no Active Directory and no installer that needs admin rights. Nothing
here reaches 10.227.56.22, eFinance or eArchive.

## Once: the three tools

Open PowerShell (normal, not «Run as administrator»: PostgreSQL refuses to
start from an elevated window) and run:

```powershell
winget install OpenJS.NodeJS.LTS Git.Git
```

Close PowerShell, open it again, then:

```powershell
npm install -g pnpm@10.33.0
node --version
pnpm --version
```

Node should print a 22.x or 24.x version. If `winget` is not on your PC,
the installers are at https://nodejs.org (LTS) and https://git-scm.com.

## Once: the code and the database

```powershell
cd $HOME
git clone -b claude/ecstatic-cray-g0zhkx https://github.com/msouzou-debug/marsou.git ecapital
cd ecapital
pnpm install
pnpm pc:setup
```

`pnpm install` fetches the packages, PostgreSQL 16 among them. `pnpm pc:setup`
creates a private database under `.tmp\pc-db`, writes the two settings
files, runs the migrations and loads the sample register: twelve units, 41
projects, 17 contracts, 8 permits, 26 assets and the twelve accounts below.
It prints a step counter and ends with `Done`. Running it again is safe.

## Every time

```powershell
cd $HOME\ecapital
pnpm pc:start
```

It starts the database, the API and the web app, then opens
http://localhost:3000 in your browser. The first page takes about half a
minute to build. Leave the window open; `Ctrl+C` in it stops everything.

## Signing in

The sign-in page lists the accounts. Click one and press «Σύνδεση». No
password: this is the development mode (ADR-0009), which the ΟΚΥπΥ server
refuses.

| Account | Role | Sees |
|---|---|---|
| `admin@ecapital.test` | Διαχειριστής | everything, plus Διαχείριση |
| `estates.nicosia@ecapital.test` | Προϊστάμενος Τεχνικών Υπηρεσιών | Nicosia General |
| `engineer.larnaca@ecapital.test` | Μηχανικός έργου | Larnaca |
| `clinical.nicosia@ecapital.test` | Κλινικός εγκριτής | permits in Nicosia General |
| `finance@ecapital.test` | Οικονομική Διεύθυνση | cost screens, all units |
| `auditor@ecapital.test` | Ελεγκτής | read only, all units |
| `executive@ecapital.test` | Διοίκηση | read only, all units |

The other five accounts on the page are a technician, a second engineer, a
second estates head, a nursing approver and a hospital director, for walking
a permit through its approvals.

## Getting the latest build

```powershell
cd $HOME\ecapital
git pull
pnpm install
pnpm pc:setup
pnpm pc:start
```

`pc:setup` after a pull applies any new migration. The sample data is
re-seeded in place; anything you typed into the sample register stays
unless a migration touches it.

## If something goes wrong

- **«Something already answers on 127.0.0.1:5433»**: a database from an
  earlier run is still up. `pnpm pc:stop`, then try again.
- **«Not set up yet»**: run `pnpm pc:setup` first.
- **The browser shows nothing after two minutes**: read the `[api]` and
  `[web]` lines in the PowerShell window. The last red line is the reason.
- **Start over**: close the window, delete the `.tmp` folder inside
  `ecapital`, run `pnpm pc:setup` again.

## What this is not

Not the ΟΚΥπΥ server, not a backup of it, and not a place for real data.
The settings files it writes (`apps\api\.env`, `apps\web\.env.local`) hold
no secrets and are ignored by git.
