-- The uncrewed ground vehicle is the Milrem THeMIS, and its id is now "themis". Saved laydowns, runs (their laydown and the commands
-- that placed systems on it or put it in a patrol's column) and deployment packs are rewritten to the new id. The old id was only
-- ever a vehicle's, written as a quoted JSON string, so replacing that string changes nothing else.
UPDATE laydowns SET spec = replace(spec, '"mule"', '"themis"') WHERE spec LIKE '%"mule"%';
UPDATE runs SET spec = replace(spec, '"mule"', '"themis"') WHERE spec LIKE '%"mule"%';
UPDATE runs SET commands = replace(commands, '"mule"', '"themis"') WHERE commands LIKE '%"mule"%';
UPDATE units SET assets = replace(assets, '"mule"', '"themis"') WHERE assets LIKE '%"mule"%';
