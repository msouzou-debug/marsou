# Questions for the eFinance session

From: eHire session, through Marios. Date: 20/11/2026.

eHire runs on the same server as eFinance (`ehire.service`, port 5008, `https://ehire.shso.online`, release 1.0.0-rc8). Marios wants eHire to look and behave like eFinance, and to take its lists from it. Please answer from the code and the server, not from memory, and say so where you are not sure.

Rules for the answers: no staff names, usernames, emails, passwords, tokens or keys. File contents (templates, CSS) and list rows without personal data are fine. Send files to Marios; he attaches them to the eHire session.

## 1. Look and layout

1. Send the base page template (the file every page extends) and the main CSS file or files.
2. The left menu: its width, background colour, how the current item is marked, how a group expands (click, arrow, always open), and whether it collapses to icons. On a phone, how does it open?
3. The top bar: what it holds (logo, user name, language switch, sign-out, notifications) and in which order.
4. Colour values in hex for: menu background, menu text, current item, page background, panel background, primary button, links, table header, success, warning, danger.
5. Font family and base size. Is the font served from the server or from the internet?
6. Which logo files are used, where (menu, top bar, sign-in page), and at what height?
7. How a detail page is laid out: where the status and the approval steps sit (right-hand column, top, tabs), and what the status column contains.
8. How a list page is laid out: filters, table or cards, paging, how status is shown (chip, colour, icon).
9. Two or three screenshots with data hidden or invented: sign-in page, a list page, a detail page with its status column, and the same detail page at phone width.
10. Does eFinance use a component library beyond Bootstrap (Select2, DataTables, a chart library)? Name and version.

## 2. Roles and rights

11. List the roles eFinance has and what each may do.
12. How are rights stored: fixed in code per role, or editable per role or per user in a screen? Send the table definitions (names and columns only).
13. Describe the administration screens for users, roles and rights: what an administrator can change, and the steps to give a person a role. A screenshot with invented data helps.
14. The "ticked entities" pattern: how does an administrator choose which entities (Directorates, hospitals) a user may see? Is it per user, per role, or both?
15. Can a user hold more than one role? Can a role be limited to one entity?
16. Is there a separate super-administrator, and what can only that account do?
17. Are changes to users, roles and rights written to an audit log? Which fields?

## 3. Active Directory

18. Which AD settings does eFinance read (variable names only): server, port, domain, base DN, CA file, bind method?
19. Is LDAPS used with the certificate checked? Where does the CA file live on the server (path only)?
20. Does the `ehire` service user need its own copy of the CA file, or can it read eFinance's?
21. After a first AD sign-in creates an inactive account, how does the administrator get told, and where do they activate it?
22. Does eFinance read anything else from AD (full name, email, department, group membership)? Are any rights driven by AD groups?
23. Does the server reach the domain controller directly, or does it need a firewall rule or the proxy?

## 4. Lists

24. Directorates (entities): code, Greek name, English name.
25. Hospitals and facilities: code, Greek name, English name, the Directorate each belongs to, and its site code (HQ, NGH, ARC, LGH, LAR, PAP, FAM, TRD, CHR, MH, HC, CNS).
26. Cost centres: code, Greek name, English name, active or not. How many are there?
27. Does eFinance hold position titles or payroll grades? If yes: title in Greek and English, and staff category.
28. In what form can you export these (CSV or Excel)? eHire has an Excel import with sheets `directorates`, `facilities`, `positions`, `cost_centres`; column names are in its template.

## 5. Server

29. Does eFinance reach Microsoft Graph through the server's web proxy (squid)? If yes, which proxy variables does its service file set (names only)?
30. How does eFinance run its scheduled jobs (cron for its service user, systemd timers)? eHire needs four cron lines and wants to follow the same pattern.
31. Where do eFinance's nightly backups go, and how are they copied off the server? eHire should use the same place and method.
32. Is port 5008 limited in the firewall? eHire listens on `0.0.0.0:5008` for the Cloudflare tunnel, which runs on another machine.
