# Unit areas

This screen shows one unit's area tree: building, floor, area. Estates staff and project engineers use it to find exactly where a job is happening.

## Steps

1. Pick the unit from the "Unit" switcher at the top left. The screen opens on that unit's areas.
2. Read the title and the "Unit › Building" trail to confirm you are in the right building.
3. Work down the tree: each floor lists its areas underneath it, with their codes.
4. Each area shows its type (theatre, ward, laboratory and so on) and its ICRA 2.0 patient risk group. Where a room has beds, the count is shown.
5. Press "?" to open this guide in a side panel. Press Esc to close it.

## What can go wrong

- **"You do not have access to this page".** The unit is not yours. The system does not say whether it exists: you see your own units and nothing else. Ask the unit's head of estates for access.
- **"No areas have been recorded for this unit".** The unit's building register has not been loaded yet. Adding areas from this screen comes in a later release; until then estates loads them from a file.
- **"The data did not load".** The API did not answer. Press "Try again". If it keeps failing, tell estates.
- **It says you are offline.** You are looking at saved data. The tree still reads normally, but it will not update until the connection is back.
- **The risk group has no colour.** That is correct. The ICRA class comes from the activity type combined with the risk group, and it is worked out on the permit screen, not here.
