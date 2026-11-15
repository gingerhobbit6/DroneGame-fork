-- The uncrewed ground vehicle is the Milrem THeMIS, and its id is now "themis". Saved laydowns, runs (their laydown and the commands
-- that placed systems on it or put it in a patrol's column) and deployment packs are rewritten to the new id.
-- shortcut: every quoted "mule" is replaced, so a system someone named exactly "mule" is relabelled "themis" too. The id sits in
-- several shapes (a key's value, a bare command argument), so only parsing the JSON would tell them apart: do that if it ever matters.
UPDATE laydowns SET spec = replace(spec, '"mule"', '"themis"') WHERE spec LIKE '%"mule"%';
UPDATE runs SET spec = replace(spec, '"mule"', '"themis"') WHERE spec LIKE '%"mule"%';
UPDATE runs SET commands = replace(commands, '"mule"', '"themis"') WHERE commands LIKE '%"mule"%';
UPDATE units SET assets = replace(assets, '"mule"', '"themis"') WHERE assets LIKE '%"mule"%';
