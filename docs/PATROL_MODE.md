# Patrol mode: design note

Status: prototype, second round. What is built is under "What it does now", and what is not is under "Left out". Everything else here explains the rules and why they were chosen.

In the fixed-site game the player defends the station, or an area drawn around it. In patrol mode the player protects soldiers walking a route through a corridor, with air defence vehicles in their formation and static systems along the way. It is a simulation for teaching, not a planning tool. Every speed, spacing, delay and enemy search figure is an assumption, labelled `ASSUMPTION` in the Sources tab under Patrol, where each can be edited (a logged change, like any other figure).

## The route and the corridor

The player opens the Area to defend panel, presses **Draw a patrol route**, clicks waypoints from the start, and double-clicks to finish at the end. The route is open: it runs from its first waypoint to its last, and does not loop.

Each leg is checked on the ground every 20 m. The route is refused if it leaves the map, crosses water, crosses ground steeper than a slope of 0.4 (the build rule), or goes through a building outline. The refusal says which, and the player redraws.

The corridor is a band along the route, 20 to 1000 m wide (200 m to start with). It is drawn on the map as a faint blue band, with a peg at each end. It is where static systems can stand: with a patrol set, the placement tools refuse a spot outside it. Redrawing the route keeps the corridor width, the formation and the vehicles.

## The formation

The soldiers (12 to start with, 5 m apart) walk in single file, a staggered column or a wedge behind the lead soldier. Each vehicle in the column has a place in the formation: metres ahead of the lead (behind if negative, up to 200 m) and metres to the right (left if negative, up to 100 m).

Every member follows the route at its own place along it, offset to the side of the way the route runs there. So the shape bends round a turn as a real patrol's would, rather than swinging round as a rigid block. Walking back, ahead and right stay ahead and right of the way the patrol faces, so the column reverses its order on the way home. At the ends of the route, members that would be beyond it bunch at the end point.

## Mobile and static systems

Mobile systems ride in the column on a Patria 6x6, a Toyota Hilux or a Mule UGV, as before. Static systems are placed from the toolbar, inside the corridor, and stay where they are: an overwatch radar on high ground, or a jammer at a choke point. Both come from the same systems and budget.

Sensors work on the move. Weapons fire from the halt: while any weapon in the column has an engagement task, the whole patrol stops, and it walks on once the task ends. A jammer works on the move. Making this a per-system choice was considered and left out: the only systems that need it today are jammers, and the rule already exempts them.

## Out and back

Once the first wave starts, the patrol walks to the end of the route, waits there (60 s to start with), and walks back. At the start it stops and holds until the next wave begins, then sets out again. Each wave is one more trip if it lasts long enough, and a trip can run across waves. Stopping at the start was chosen over looping straight away so that a trip has a clear end, the run can be read as "how many trips did it get through", and the next wave is the natural moment to go again.

The timeline marks each step: set out, reached the end, heading back, back at the start. The Area panel shows where it is, how many trips are done, and how old the enemy's fix is.

## How the enemy finds the patrol

Strikes no longer know where the patrol is. They home on the last fix passed to them, and the fix comes from spotters.

- **Search.** A spotter flies to the nearest point of the route and sweeps along it, end to end and back, until its camera picks the patrol out. It must be within 3.5 km, with working video and a line of sight clear of the ground and of tree canopy. It looks once a second.
- **Fix.** Once it has found the patrol, the spotter circles it at its standoff range and passes a fix each time it sees it. The red ring on the map is that fix, which is where strikes are heading.
- **Stale.** If the spotter is jammed (its video link), shot down, or loses sight behind a hill or into woods, the fix stops updating, and strikes keep heading for where the patrol was. A strike that arrives where no soldier is within 30 m comes down there and is wasted, though anyone close to the blast can still be hurt. The timeline shows it as a miss.
- **Waiting.** With no fix at all, strikes fly to the corridor's middle and circle within 400 m of it. After 10 minutes waiting they turn for home and leave the attack.
- **Seeing it themselves.** A strike flown by video (an FPV, or a fibre-optic drone) sees the patrol for itself within 500 m with a clear line of sight, and then homes on the patrol itself. Its video must not be jammed.
- **Emitters.** Drones that seek loud emitters still go for them, so a radar or a jamming jammer in the column or the corridor can still draw FPVs.

Drones still spawn around the patrol, as they do around a drawn area. That means the enemy knows the area of operations but not the patrol's place in it.

| Figure | Value | Basis |
| --- | --- | --- |
| Walking speed | 1.4 m/s | assumption |
| Soldiers | 12 | assumption |
| Spacing in the formation | 5 m | assumption |
| Wait at the end | 60 s | assumption |
| Gap for a new vehicle | 40 m | assumption |
| Spotter sees the patrol | 3,500 m | assumption |
| Strike drone sees it itself | 500 m | assumption |
| Strike waits within | 400 m | assumption |
| Strike can wait for | 600 s | assumption |

## Winning and losing

These are unchanged: the patrol has the same integrity as the site, a strike that reaches it costs the same, and the run is lost at zero. Strikes can cause casualties among the soldiers. A strike wasted on a stale fix costs nothing.

## Saving

A saved laydown carries the route as `patrol: [[x, z], ...]`, the column as `patrolColumn: [{ vehicle, system, gap, side }, ...]`, and the plan as `patrolPlan: { width, formation }`. The backend checks each one. The game checks the route again on the ground when it is restored. A laydown saved before this round gets a 200 m corridor and single file, and its route, once a loop, is now walked as an open route from its first waypoint to its last.

## Determinism, replay and digests

- Nothing in the patrol or the enemy search draws a random number. Spotters look once a second of game time, so the same seed and laydown give the same run.
- A run with no patrol runs none of this code, so the fixed-site reference digests do not change. The tests check it.
- A patrol run adds its distance walked, phase, trips and the enemy's fix to its digest.
- Replay does not yet record where the patrol or its escort was, so a replay draws them where they are now.

## What it does now

- An open route with a corridor of a chosen width. Static systems go inside the corridor.
- Soldiers in single file, a staggered column or a wedge, with each vehicle ahead, behind or to one side, keeping their places round turns.
- Out to the end, wait, back to the start, then hold until the next wave.
- Spotters search the corridor and pass fixes, which go stale when the spotter is jammed, shot down or loses sight. Strikes waste themselves on stale fixes, wait mid-corridor with none, and see the patrol for themselves when close with a camera.

## Left out

- Free placement of each soldier by hand: the three formations only.
- Routes along mapped roads and paths, rather than straight legs.
- Penalties for sensing on the move, and stopping to sweep.
- A per-system halt-to-fire choice.
- Spotters picking the patrol out by its emissions, or seeing the static systems and passing them as targets.
- Win by trips, and loss by casualties or by losing the whole column.
- Escort and soldier positions in replay snapshots.
- A hotkey or toolbar button for the patrol: it is in the Area panel only.
- Static systems placed before the corridor existed, or left outside it when the route is redrawn, are not moved or refused.
