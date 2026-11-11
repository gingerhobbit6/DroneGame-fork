# People: simulated people, crews and casualties

This document covers the simulated people in Bombadil: the groups you can place, how protection shelters them, how a drone's blast can kill or injure them, the crews that work some systems by hand, the soldiers of a patrol, and how casualties are counted, shown and replayed. It is written for a reader who wants to know what the casualty numbers mean and how little weight they can bear, and for a developer who wants to change them.

**Every casualty figure is a round-number assumption chosen to show the idea. None of it is real casualty or weapons-effects data** ([`people.js:1`](../frontend/src/sim/config/people.js#L1)). Do not base real decisions on it.

## Contents

- [Groups of people](#groups-of-people)
- [Placing people](#placing-people)
- [How a blast hurts people](#how-a-blast-hurts-people)
- [Do people change the attack?](#do-people-change-the-attack)
- [Crews](#crews)
- [Patrols and escorts](#patrols-and-escorts)
- [Counting and showing casualties](#counting-and-showing-casualties)
- [Limits and simplifications](#limits-and-simplifications)
- [Where this lives in the code](#where-this-lives-in-the-code)

## Groups of people

People are placed in groups. Each group has a size, a role and a level of protection.

**Limits:** up to 50 groups, each of 1 to 500 people ([`people.js:12`](../frontend/src/sim/config/people.js#L12)).

**Roles** ([`people.js:27`](../frontend/src/sim/config/people.js#L27)) change only how the people are drawn. A soldier and a civilian in the same place are hurt alike.

| Role | Drawn as |
|---|---|
| Civilians | Everyday clothes |
| Soldiers | MultiCam, with helmets, body armour and rifles |

**Protection** ([`people.js:6`](../frontend/src/sim/config/people.js#L6) to [`people.js:10`](../frontend/src/sim/config/people.js#L10)) sets two numbers, both assumptions and both editable in the Sources tab:

- **Casualty chance at the blast** (`pCasualty`): the chance a person right at the point of the blast is hurt.
- **Reach scale** (`reachScale`): how far the blast reaches them, as a share of the drone's casualty radii.

| Protection | Casualty chance at the blast | Reach scale | How they are placed and drawn |
|---|---|---|---|
| Unarmoured | 0.9 | 1 | In the open, on clear ground |
| In a building | 0.35 | 0.6 | Inside an ordinary building: you click on one |
| In a bunker | 0.03 | 0.2 | In a hardened shelter, drawn as a low concrete block |

## Placing people

Use the **People** tool on the toolbar, or key **9** ([`useHotkeys.js:51`](../frontend/src/ui/useHotkeys.js#L51)). Its panel ([`PeoplePicker.jsx`](../frontend/src/ui/PeoplePicker.jsx), the `PeopleChoice` controls) sets the size, role and protection of the next group, which starts as 10 civilians in the open ([`view.js:24`](../frontend/src/render/view.js#L24)). Then click the map. The wizard's optional step 6, "Who is on site?", shows the same controls ([`PeopleStep.jsx`](../frontend/src/ui/assistant/PeopleStep.jsx)).

A group cannot be placed ([`people.js:60`](../frontend/src/sim/people.js#L60) to [`people.js:73`](../frontend/src/sim/people.js#L73)):

- once the laydown is locked at the first wave, or past 50 groups;
- off the map when you have drawn an area or set a patrol, or otherwise more than 2,500 m from the station ([`attack-area.js:10`](../frontend/src/sim/attack-area.js#L10), [`world.js:39`](../frontend/src/sim/config/world.js#L39));
- **in a building** anywhere but on a building;
- **in the open or a bunker** on a building, in water, or on ground steeper than a slope of 0.4.

How the people in a group are laid out ([`people.js:41`](../frontend/src/sim/people.js#L41)). The layout is seeded from the group's position, so the same group always stands the same way.

- **In the open:** a loose crowd, a sunflower spiral about 1.5 m between people with a little jitter.
- **In a building:** spread over the building's real outline, turned to match it, 1 m clear of the walls. A marked building cell with no outline counts as a 16 m square.
- **In a bunker:** spread over a square of side √(1.5 × count) + 2 m, so 1.5 m² each with 1 m clear of each wall ([`people.js:18`](../frontend/src/sim/people.js#L18)).

People cost nothing. They lock with the laydown when the first wave starts and are saved with it, sorted so the order you placed them in cannot change a run; the role is saved only for soldiers ([`people.js:99`](../frontend/src/sim/people.js#L99)). They are drawn at true scale, so each group also has a name tag, and **Look** in the People panel flies the camera down to them.

## How a blast hurts people

### When a blast happens

A drone's warhead goes off, and can hurt people, in these cases. Only a drone with a warhead above 0 makes a blast, and nothing is rolled while no people are placed ([`people.js:135`](../frontend/src/sim/people.js#L135)).

| What happened | Where the blast is | Code |
|---|---|---|
| Destroyed in flight by a weapon | Where the drone is, in the air: its height above a group shelters them | [`people.js:138`](../frontend/src/sim/people.js#L138) |
| Brought down by jamming | Where the drone is, in the air | [`drones.js:230`](../frontend/src/sim/drones.js#L230) |
| Struck one of your systems | On the ground at the system | [`targeting.js:100`](../frontend/src/sim/targeting.js#L100) |
| Struck the station, with no drawn area | On the ground at a random bearing and a random distance out to 150 m from the middle, so more often near the middle | [`people.js:148`](../frontend/src/sim/people.js#L148) to [`people.js:154`](../frontend/src/sim/people.js#L154) |
| Struck a drawn area | On the ground at its aim point | [`people.js:150`](../frontend/src/sim/people.js#L150) |
| Struck the patrol, or where the patrol had been | On the ground at the fix it was flying to | [`drones.js:94`](../frontend/src/sim/drones.js#L94), [`drones.js:100`](../frontend/src/sim/drones.js#L100) |

No blast comes from a drone taken over and landed by a jammer, one that turned for home, or one that left the area. Spotters carry no warhead. Drone behaviour is in [DRONES.md](DRONES.md).

### Casualty radii

Each warhead has a lethal radius and an injury radius for a person in the open, growing with the cube root of its explosive mass, as blast and fragments scale ([`people.js:14`](../frontend/src/sim/config/people.js#L14) to [`people.js:24`](../frontend/src/sim/config/people.js#L24)):

- lethal radius = 9 × ∛(warhead kg) m
- injury radius = 25 × ∛(warhead kg) m

The constants are anchored on the M67 hand grenade, whose 0.18 kg of explosive the US Army gives a 5 m lethal and 15 m casualty radius ([GlobalSecurity: M67 grenade](https://www.globalsecurity.org/military/systems/munitions/m67.htm), [Wikipedia: M67 grenade](https://en.wikipedia.org/wiki/M67_grenade)). With these constants the M67 itself comes out at 5.1 m and 14.1 m. The config notes that bigger warheads throw heavier fragments further, so the radii are likely low for them. Protection multiplies both radii by its reach scale. The physics behind blast and the site damage rule are in [PHYSICS_AND_PROPAGATION.md](PHYSICS_AND_PROPAGATION.md).

Lethal / injury radius in metres, for the generic strike types (printed from the config by a script):

| Protection | Casualty chance at the blast | Reach scale | Fibre-optic (2 kg) | First-person-view (2 kg) | Fixed-wing strike (30 kg) |
|---|---|---|---|---|---|
| Unarmoured | 0.9 | 1 | 11.3 / 31.5 | 11.3 / 31.5 | 28 / 77.7 |
| In a building | 0.35 | 0.6 | 6.8 / 18.9 | 6.8 / 18.9 | 16.8 / 46.6 |
| In a bunker | 0.03 | 0.2 | 2.3 / 6.3 | 2.3 / 6.3 | 5.6 / 15.5 |

<details>
<summary>Radii for every drone, in the open</summary>

| Drone | Warhead, kg | Lethal radius, m | Injury radius, m |
|---|---|---|---|
| Fixed-wing spotter | 0 | 0 | 0 |
| Fibre-optic | 2 | 11.3 | 31.5 |
| First-person-view | 2 | 11.3 | 31.5 |
| Fixed-wing strike | 30 | 28 | 77.7 |
| Geran-2 | 50 | 33.2 | 92.1 |
| Lancet-3 | 4 | 14.3 | 39.7 |
| Orlan-10 | 0 | 0 | 0 |
| Molniya-2 | 4.5 | 14.9 | 41.3 |
| KVN | 4.5 | 14.9 | 41.3 |
| Gerbera | 6 | 16.4 | 45.4 |
| Shahed-136 | 35 | 29.4 | 81.8 |
| Shahed-131 | 15 | 22.2 | 61.7 |
| Mohajer-6 | 0 | 0 | 0 |
| Ababil-2 | 0 | 0 | 0 |
| CH-901 | 3 | 13 | 36.1 |
| Feilong-300D | 45 | 32 | 88.9 |
| Sunflower-200 | 40 | 30.8 | 85.5 |
| ASN-209 | 0 | 0 | 0 |
| Skywalker | 2 | 11.3 | 31.5 |
| Geran-3 | 50 | 33.2 | 92.1 |
| ASN-301 | 30 | 28 | 77.7 |
| Wing Loong II | 0 | 0 | 0 |
| Mavic 3 | 0.3 | 6 | 16.7 |
| Matrice 30T | 1 | 9 | 25 |
| Matrice 300 | 2 | 11.3 | 31.5 |
| Agras T30 | 20 | 24.4 | 67.9 |
| EVO Max 4T | 0.5 | 7.1 | 19.8 |
| 7-inch quad | 1.75 | 10.8 | 30.1 |
| Last-mile FPV | 1.75 | 10.8 | 30.1 |
| Mini 4 Pro | 0 | 0 | 0 |
| Mavic 3T | 0.3 | 6 | 16.7 |
| Mavic 3 Pro | 0.3 | 6 | 16.7 |
| EVO II 640T | 0.3 | 6 | 16.7 |
| 10-inch quad | 3 | 13 | 36.1 |
| 13-inch quad | 6 | 16.4 | 45.4 |

</details>

### Who is hurt

For each person not already hurt, with `d` the straight-line distance in 3D from the blast to them, `L` and `I` the lethal and injury radii after the reach scale, and `p` the casualty chance at the blast ([`people.js:110`](../frontend/src/sim/people.js#L110) to [`people.js:131`](../frontend/src/sim/people.js#L131)):

- beyond `I`, nothing happens;
- otherwise one roll `r` from 0 to 1: killed if `r < p × max(0, 1 − d / L)`, else injured if `r < p × (1 − d / I)`, else unhurt.

So the chance of being hurt at all falls in a straight line from `p` at the blast to nothing at the injury radius, and the chance of being killed falls from `p` to nothing at the lethal radius. A person is hurt at most once. Distance is measured to the group's ground height, so a drone destroyed high up hurts nobody below: an FPV's injury radius in the open is 31.5 m, so one destroyed 50 m up hurts no one.

For example, an FPV (2 kg) going off on the ground 5 m from a person in the open: the kill chance is 0.9 × (1 − 5 / 11.34) = 0.50 and the chance of any harm is 0.9 × (1 − 5 / 31.50) = 0.76, so about a 50% chance of death, 25% of injury and 24% of no harm.

Each drone's blast draws from a random stream of its own, seeded from the run's seed and the drone's number ([`people.js:134`](../frontend/src/sim/people.js#L134)), so casualty rolls never disturb the rest of the run.

## Do people change the attack?

- **Without a drawn area or a patrol, no.** Strikes go for the station or for loud emitters, and casualty rolls use their own streams, so a run plays out the same with or without people.
- **With a drawn area, yes.** People inside the area are one of the three kinds of target a strike drone may aim at, with a share of 0.30 against 0.45 for systems and 0.25 for buildings ([`targeting.js:17`](../frontend/src/sim/targeting.js#L17), [`targeting.js:40`](../frontend/src/sim/targeting.js#L40)). Placing or removing a group inside the area changes where strikes aim, and so the run.
- **With a patrol,** its soldiers are what the enemy hunts ([Patrols and escorts](#patrols-and-escorts)).

## Crews

Some systems are worked by hand, off the network (`networked: false`): two vehicle machine guns and five handheld jammers ([`crew.js:27`](../frontend/src/sim/config/crew.js#L27)). Their figures are in [EFFECTORS.md](EFFECTORS.md) and their vehicles in [VEHICLES.md](VEHICLES.md).

| System | Kind | Health |
|---|---|---|
| Small gun (L7A2 general purpose machine gun on a vehicle pintle) | Gun | 20 |
| Crewed .50 cal (L111A1 heavy machine gun on a vehicle pintle) | Gun | 20 |
| DroneGun Mk4, SkyWiper, Kvertus G-6, DroneGun MkIII, DroneGun Tactical | Handheld jammer | 15 |

The fusion node cannot task them. Instead the crew looks round every 0.5 s and takes the nearest drone it can see within the system's range, or for a jammer one it has been warned of ([`crew.js:38`](../frontend/src/sim/crew.js#L38)). A jammer crew points its 30° beam at its target and jams only while it has one. How far a crew sees, hears and is warned ([`crew.js:13`](../frontend/src/sim/config/crew.js#L13), [`crew.js:19`](../frontend/src/sim/crew.js#L19) to [`crew.js:26`](../frontend/src/sim/crew.js#L26)):

| Figure | Value | Basis |
|---|---|---|
| Sight | Where the drone's span fills 0.065°, up to 3,000 m, times the light (never below half at night) | Field trial: half of observers saw a Phantom 4 at 245 m and a Mavic Air at 307 m ([MDPI Applied Sciences](https://www.mdpi.com/2076-3417/10/16/5501)); the 3,000 m cap is an assumption |
| Hearing | 300 m times the drone's loudness, halved in rain | Assumption |
| Wearable detector | Warns of a drone with a radio link within 400 m | Assumption |
| Reaction | 3 s from seeing a drone to firing or jamming, unless already warned for that long | Assumption |

By day a crew sees an FPV (0.35 m) at about 309 m, a Shahed-class drone (2.5 m) at about 2,204 m and the generic spotter (3 m) at about 2,644 m; at dusk, at night or in rain, half that. It hears the generic fixed-wing strike drone at 1,500 m and an FPV at 300 m. A fibre-optic drone has no radio link, so the detector never warns of it.

**What losing a crew does.** Crews are not simulated as people. A crew exists only as its system's behaviour, so the crew is lost when the system is: a strike that brings the system's health to 0 removes it and counts its value as lost ([`targeting.js:106`](../frontend/src/sim/targeting.js#L106)). No crew casualty is counted. A blast at the system can still hurt any group of people placed near it. The same holds for the crews of networked systems and patrol vehicles, which are not modelled at all.

## Patrols and escorts

In patrol mode you protect soldiers walking a route instead of a site. The full rules are in [PATROL_MODE.md](PATROL_MODE.md); the parts that concern people are these.

- **The soldiers** are a group of 12, in the open, drawn as soldiers ([`patrol.js:67`](../frontend/src/sim/patrol.js#L67), [`patrol.js:9`](../frontend/src/sim/config/patrol.js#L9)). They are hurt exactly as any other group. The group is rebuilt from the route, so it is not saved with the other groups and cannot be removed on its own.
- **Formation** ([`formation.js:14`](../frontend/src/sim/formation.js#L14)): single file, a staggered column or a wedge, 5 m apart. Each soldier follows the route at their own place along it.
- **Movement:** 1.4 m/s out to the end of the route, 60 s wait, then back, then hold until the next wave. The whole patrol halts while any weapon in the column (not a jammer) is engaging ([`patrol.js:120`](../frontend/src/sim/patrol.js#L120)).
- **Escorts:** 1 to 6 vehicles, each carrying one system, up to 200 m ahead or behind and 100 m to either side ([`patrol.js:41`](../frontend/src/sim/config/patrol.js#L41) to [`patrol.js:43`](../frontend/src/sim/config/patrol.js#L43)). A new patrol gets a Toyota Hilux with a Blighter A800 radar 40 m ahead and a Patria 6x6 with a Rapid Ranger 40 m behind ([`patrol.js:12`](../frontend/src/sim/config/patrol.js#L12)). A strike on a system riding a Patria does half damage (armour 2). The vehicles' crews are not modelled.
- **How the enemy finds them** ([`patrol.js:18`](../frontend/src/sim/config/patrol.js#L18)): a spotter sees the patrol within 3,500 m with a clear line of sight and passes a fix; a strike flown by video sees it for itself within 500 m; with no fix, strikes circle within 400 m of the corridor's middle for up to 600 s.
- **A strike on the patrol** takes integrity as a strike on the site does, and its blast lands at the fix among the soldiers. If no soldier is within 30 m of the fix, it is a miss with no loss of integrity, but the blast can still hurt anyone close ([`hunt.js:61`](../frontend/src/sim/hunt.js#L61)).
- Casualties do not end a patrol run: it is lost only when integrity reaches 0, shown as "PATROL LOST".

All of these figures are labelled assumptions in the Sources tab.

## Counting and showing casualties

When a blast hurts anyone, the run adds to its killed, injured and total casualty counts, records a casualty event such as "First-person-view strike drone: 2 killed, 1 injured (simulated)", and shows the same text as a toast ([`people.js:126`](../frontend/src/sim/people.js#L126) to [`people.js:130`](../frontend/src/sim/people.js#L130)).

| Where | What it shows |
|---|---|
| HUD | People killed and injured so far ([`Hud.jsx:66`](../frontend/src/ui/Hud.jsx#L66)) |
| Timeline | A marker for each casualty event ([`Timeline.jsx:11`](../frontend/src/ui/Timeline.jsx#L11)) |
| The map | Injured and killed people drawn down, each in its own colour; each group's tag adds "N hurt" ([`people-view.js:183`](../frontend/src/render/people-view.js#L183)) |
| People panel | Each group as unhurt of total ([`PeoplePicker.jsx:43`](../frontend/src/ui/PeoplePicker.jsx#L43)) |
| End of run | Killed and injured of all people, broken down by protection level ([`Overlay.jsx:80`](../frontend/src/ui/Overlay.jsx#L80) to [`Overlay.jsx:95`](../frontend/src/ui/Overlay.jsx#L95)) |

- **Replay.** Each snapshot, every 0.5 s of game time, stores how many in each group were down ([`recorder.js:24`](../frontend/src/sim/recorder.js#L24)). Scrubbing back redraws exactly who was down at that moment ([`people-view.js:193`](../frontend/src/render/people-view.js#L193)).
- **Digest.** With people placed, who was hurt is part of the run's digest, so a replayed run must reproduce the same casualties ([`simulation.js:244`](../frontend/src/sim/simulation.js#L244)). With no people, the digest is unchanged.
- **Saved runs.** The run record sent to your history holds the laydown (with its people) and the command log, but no casualty headline ([`run-record.js:10`](../frontend/src/sim/run-record.js#L10)). Casualties come back by replaying it. The per-wave statistics do not include casualties.
- **Sandbox.** Casualties count there too. Leaving the sandbox resets the run, and every group comes back unhurt.

## Limits and simplifications

- **Assumed numbers.** The casualty chances, reach scales and radius constants are round numbers chosen to teach the idea, not data.
- **A point blast with a straight-line fall-off.** No fragment pattern, direction of attack, fragment mass, secondary fire or debris, and no ground or wall in the way: a person behind a hill is hurt as if in the open at that distance.
- **Protection is a multiplier on the whole group.** A building's construction, a person's floor or room, and body armour are not modelled. A soldier and a civilian are hurt alike.
- **One height per group.** Every person in a group is taken to stand at the group's ground height.
- **Hurt is final.** There is no treatment, evacuation, or injured person dying later.
- **People do not react.** They do not take cover or run (the crouching pose up close is drawing only), and only the patrol moves.
- **Crews are not people.** Losing a crewed system loses its crew's capability, but no crew casualty is counted.
- **Casualties never end a run**, and loss by casualties is left out of patrol mode.
- **The radius constants (9 and 25) cannot be edited** in the Sources tab; the casualty chance and reach scale of each protection level, and each drone's warhead, can.

## Where this lives in the code

- [`frontend/src/sim/config/people.js`](../frontend/src/sim/config/people.js): protection levels, roles, limits and the casualty radius rule.
- [`frontend/src/sim/people.js`](../frontend/src/sim/people.js): placing groups, laying them out, saving them, and the blast rolls.
- [`frontend/src/sim/crew.js`](../frontend/src/sim/crew.js) and [`config/crew.js`](../frontend/src/sim/config/crew.js): crewed systems and how their crews see, hear and react.
- [`frontend/src/sim/patrol.js`](../frontend/src/sim/patrol.js), [`config/patrol.js`](../frontend/src/sim/config/patrol.js), [`formation.js`](../frontend/src/sim/formation.js) and [`hunt.js`](../frontend/src/sim/hunt.js): the patrol, its escorts and how the enemy finds it.
- [`frontend/src/ui/PeoplePicker.jsx`](../frontend/src/ui/PeoplePicker.jsx): the People tool's panel, also used by the wizard.
- [`frontend/src/render/people-view.js`](../frontend/src/render/people-view.js): drawing people, casualties and their state in replay.
